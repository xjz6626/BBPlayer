import { bilibiliApi } from '@/lib/api/bilibili/api'
import type {
	BilibiliCommentItem,
	BilibiliVideoDetails,
} from '@/types/apis/bilibili'
import { storage } from '@/utils/mmkv'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'

const WEEKLY_UP_MID = 156489
const WEEKLY_TITLE_RE = /周刊虚拟歌手中文曲排行榜[♪#\s]*(\d+)/
const SECTION_RE = /^【(.+?)】$/
const RANK_LINE_RE = /^(\d+)\s+(BV[0-9A-Za-z]+)/
const OP_ED_LINE_RE = /^(OP|ED)[:：]\s*(BV[0-9A-Za-z]+)/i
const SUPER_HIT_LINE_RE = /^SH\s+(BV[0-9A-Za-z]+)(?:\s+(.+))?$/i
const WEEKLY_RANK_CACHE_VERSION = 2
const DETAIL_CONCURRENCY = 6

export type WeeklyRankEntryType = 'rank' | 'super-hit' | 'op' | 'ed'

export interface WeeklyRankEntry {
	id: string
	section: string
	type: WeeklyRankEntryType
	label: string
	rank?: number
	bvid: string
	title: string
	detail?: BilibiliVideoDetails
}

export interface WeeklyRankSection {
	title: string
	entries: WeeklyRankEntry[]
}

export interface WeeklyRankData {
	video: {
		aid: number
		bvid: string
		title: string
		cover: string
		pubdate: number
		issue?: number
	}
	commentAuthor?: string
	sections: WeeklyRankSection[]
	total: number
}

interface WeeklyRankCache {
	version: number
	expiresAt: number
	data: WeeklyRankData
}

const getNextSundayNoon = (now = new Date()) => {
	const next = new Date(now)
	const daysUntilSunday = (7 - now.getDay()) % 7
	next.setDate(now.getDate() + daysUntilSunday)
	next.setHours(12, 0, 0, 0)
	if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7)
	return next.getTime()
}

const readCache = () => {
	try {
		const raw = storage.getString('weekly-vocal-rank-cache')
		if (!raw) return undefined
		const cache = JSON.parse(raw) as WeeklyRankCache
		if (
			cache.version !== WEEKLY_RANK_CACHE_VERSION ||
			cache.expiresAt <= Date.now()
		) {
			return undefined
		}
		return cache.data
	} catch {
		return undefined
	}
}

const writeCache = (data: WeeklyRankData) => {
	storage.set(
		'weekly-vocal-rank-cache',
		JSON.stringify({
			version: WEEKLY_RANK_CACHE_VERSION,
			expiresAt: getNextSundayNoon(),
			data,
		} satisfies WeeklyRankCache),
	)
}

export const clearWeeklyVocalRankCache = () => {
	storage.remove('weekly-vocal-rank-cache')
}

const createSection = (sections: WeeklyRankSection[], title: string) => {
	let section = sections.find((item) => item.title === title)
	if (!section) {
		section = { title, entries: [] }
		sections.push(section)
	}
	return section
}

const orderSections = (sections: WeeklyRankSection[]) => {
	const opEntries: WeeklyRankEntry[] = []
	const superHitSections: WeeklyRankSection[] = []
	const middleSections: WeeklyRankSection[] = []
	const edEntries: WeeklyRankEntry[] = []

	for (const section of sections) {
		if (section.title === 'Super Hit') {
			superHitSections.push(section)
		} else if (section.title === 'OP/ED') {
			for (const entry of section.entries) {
				if (entry.type === 'op') opEntries.push({ ...entry, section: 'OP' })
				if (entry.type === 'ed') edEntries.push({ ...entry, section: 'ED' })
			}
		} else {
			middleSections.push(section)
		}
	}

	return [
		...(opEntries.length > 0 ? [{ title: 'OP', entries: opEntries }] : []),
		...superHitSections,
		...middleSections,
		...(edEntries.length > 0 ? [{ title: 'ED', entries: edEntries }] : []),
	]
}

export const parseWeeklyRankComment = (
	reply: BilibiliCommentItem,
): WeeklyRankSection[] => {
	const sections: WeeklyRankSection[] = []
	let currentSection: WeeklyRankSection | undefined
	let entryIndex = 0

	for (const rawLine of reply.content.message.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line) continue

		const sectionMatch = line.match(SECTION_RE)
		if (sectionMatch?.[1]) {
			currentSection = createSection(sections, sectionMatch[1])
			continue
		}
		if (!currentSection) continue

		const superHitMatch = line.match(SUPER_HIT_LINE_RE)
		const opEdMatch = line.match(OP_ED_LINE_RE)
		const rankMatch = line.match(RANK_LINE_RE)
		let type: WeeklyRankEntryType | undefined
		let label: string | undefined
		let bvid: string | undefined
		let rank: number | undefined

		if (currentSection.title === 'Super Hit' && superHitMatch?.[1]) {
			type = 'super-hit'
			label = 'SH'
			bvid = superHitMatch[1]
		} else if (opEdMatch?.[1] && opEdMatch[2]) {
			label = opEdMatch[1].toUpperCase()
			type = label === 'OP' ? 'op' : 'ed'
			bvid = opEdMatch[2]
		} else if (rankMatch?.[1] && rankMatch[2]) {
			rank = Number(rankMatch[1])
			label = String(rank)
			type = 'rank'
			bvid = rankMatch[2]
		}

		if (!type || !label || !bvid) continue
		const jump = reply.content.jump_url?.[bvid]
		currentSection.entries.push({
			id: `${currentSection.title}-${entryIndex++}-${label}-${bvid}`,
			section: currentSection.title,
			type,
			label,
			rank,
			bvid,
			title: jump?.title?.trim() || bvid,
		})
	}

	return orderSections(sections.filter((section) => section.entries.length > 0))
}

const enrichEntries = async (
	sections: WeeklyRankSection[],
	signal?: AbortSignal,
) => {
	const bvids = Array.from(
		new Set(
			sections.flatMap((section) => section.entries.map((entry) => entry.bvid)),
		),
	)
	const detailMap = new Map<string, BilibiliVideoDetails>()

	for (let index = 0; index < bvids.length; index += DETAIL_CONCURRENCY) {
		const batch = bvids.slice(index, index + DETAIL_CONCURRENCY)
		const results = await Promise.allSettled(
			batch.map((bvid) =>
				returnOrThrowAsync(bilibiliApi.getVideoDetails({ bvid, signal })),
			),
		)
		results.forEach((result, resultIndex) => {
			if (result.status === 'fulfilled') {
				detailMap.set(batch[resultIndex], result.value)
			}
		})
	}

	return sections.map((section) => ({
		...section,
		entries: section.entries.map((entry) => {
			const detail = detailMap.get(entry.bvid)
			return detail ? { ...entry, title: detail.title, detail } : entry
		}),
	}))
}

export const getLatestWeeklyVocalRank = async ({
	force = false,
	signal,
}: {
	force?: boolean
	signal?: AbortSignal
} = {}): Promise<WeeklyRankData> => {
	if (!force) {
		const cached = readCache()
		if (cached) return cached
	}

	const uploaded = await returnOrThrowAsync(
		bilibiliApi.getUserUploadedVideos({
			mid: WEEKLY_UP_MID,
			pn: 1,
			keyword: '周刊虚拟歌手中文曲排行榜',
			signal,
		}),
	)
	const source = uploaded.list.vlist.find((item) =>
		WEEKLY_TITLE_RE.test(item.title),
	)
	if (!source) throw new Error('没有找到周刊投稿')

	const comments = await returnOrThrowAsync(
		bilibiliApi.getComments({ bvid: source.bvid, next: 0, mode: 2, signal }),
	)
	const replies = [
		...(comments.top.upper ? [comments.top.upper] : []),
		...(comments.replies ?? []),
	]
	const rankReply = replies.find(
		(reply) =>
			reply.content.message.includes('【主榜】') &&
			/BV[0-9A-Za-z]+/.test(reply.content.message),
	)
	if (!rankReply) throw new Error('没有找到榜单评论')

	const sections = await enrichEntries(
		parseWeeklyRankComment(rankReply),
		signal,
	)
	const issue = source.title.match(WEEKLY_TITLE_RE)?.[1]
	const data: WeeklyRankData = {
		video: {
			aid: source.aid,
			bvid: source.bvid,
			title: source.title,
			cover: source.pic,
			pubdate: source.created,
			issue: issue ? Number(issue) : undefined,
		},
		commentAuthor: rankReply.member.uname,
		sections,
		total: sections.reduce((sum, section) => sum + section.entries.length, 0),
	}
	writeCache(data)
	return data
}
