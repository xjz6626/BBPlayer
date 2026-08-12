import { av2bv } from './bilibiliId'

export interface BilibiliVideoTextReference {
	kind: 'video'
	bvid: string
	page?: number
	raw: string
	index: number
}

export interface BilibiliShortTextReference {
	kind: 'short'
	url: string
	raw: string
	index: number
}

export type BilibiliTextReference =
	| BilibiliVideoTextReference
	| BilibiliShortTextReference

export interface BilibiliTextParseResult {
	references: BilibiliTextReference[]
	duplicateCount: number
}

const VIDEO_ID_PATTERN = '(?:BV[0-9A-Za-z]{10}|av[1-9][0-9]*)'
const VIDEO_URL_REGEX = new RegExp(
	`(?:https?:\\/\\/)?(?:(?:www|m)\\.)?bilibili\\.com\\/video\\/(${VIDEO_ID_PATTERN})(?:\\/)?(?:\\?[^\\s<>"']*)?`,
	'gi',
)
const SHORT_URL_REGEX =
	/(?:https?:\/\/)?b23\.tv\/([0-9A-Za-z]+)(?:\?[^\s<>"']*)?/gi
const BARE_VIDEO_ID_REGEX = new RegExp(`\\b(${VIDEO_ID_PATTERN})\\b`, 'gi')

const normalizeBvid = (videoId: string): string | null => {
	if (/^BV[0-9A-Za-z]{10}$/i.test(videoId)) {
		return `BV${videoId.slice(2)}`
	}

	const avidMatch = /^av([1-9][0-9]*)$/i.exec(videoId)
	if (!avidMatch) return null

	try {
		return av2bv(BigInt(avidMatch[1]))
	} catch {
		return null
	}
}

const parsePage = (value: string): number | undefined => {
	const pageMatch = /(?:[?&])p=([1-9][0-9]*)/i.exec(value)
	if (!pageMatch) return undefined

	const page = Number(pageMatch[1])
	return Number.isSafeInteger(page) ? page : undefined
}

export const parseBilibiliVideoUrl = (
	value: string,
	index = 0,
): BilibiliVideoTextReference | null => {
	const match = new RegExp(
		`(?:https?:\\/\\/)?(?:(?:www|m)\\.)?bilibili\\.com\\/video\\/(${VIDEO_ID_PATTERN})`,
		'i',
	).exec(value)
	if (!match) return null

	const bvid = normalizeBvid(match[1])
	if (!bvid) return null

	return {
		kind: 'video',
		bvid,
		page: parsePage(value),
		raw: value,
		index,
	}
}

const isInsideRange = (
	index: number,
	ranges: { start: number; end: number }[],
) => ranges.some((range) => index >= range.start && index < range.end)

const referenceKey = (reference: BilibiliTextReference) => {
	if (reference.kind === 'short') return `short:${reference.url.toLowerCase()}`
	return `video:${reference.bvid}:${reference.page ?? 1}`
}

/**
 * 从任意评论文本中按出现顺序提取 B 站视频目标。
 * 支持完整链接、裸 BV/av 号和 b23.tv 短链接。
 */
export const parseBilibiliTextReferences = (
	text: string,
): BilibiliTextParseResult => {
	const candidates: BilibiliTextReference[] = []
	const urlRanges: { start: number; end: number }[] = []

	VIDEO_URL_REGEX.lastIndex = 0
	for (const match of text.matchAll(VIDEO_URL_REGEX)) {
		const index = match.index
		const raw = match[0]
		const reference = parseBilibiliVideoUrl(raw, index)
		if (reference) candidates.push(reference)
		urlRanges.push({ start: index, end: index + raw.length })
	}

	SHORT_URL_REGEX.lastIndex = 0
	for (const match of text.matchAll(SHORT_URL_REGEX)) {
		const index = match.index
		const raw = match[0]
		candidates.push({
			kind: 'short',
			url: `https://b23.tv/${match[1]}`,
			raw,
			index,
		})
		urlRanges.push({ start: index, end: index + raw.length })
	}

	BARE_VIDEO_ID_REGEX.lastIndex = 0
	for (const match of text.matchAll(BARE_VIDEO_ID_REGEX)) {
		const index = match.index
		if (isInsideRange(index, urlRanges)) continue

		const bvid = normalizeBvid(match[1])
		if (!bvid) continue
		candidates.push({
			kind: 'video',
			bvid,
			raw: match[0],
			index,
		})
	}

	candidates.sort((a, b) => a.index - b.index)

	const seen = new Set<string>()
	const references = candidates.filter((reference) => {
		const key = referenceKey(reference)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})

	return {
		references,
		duplicateCount: candidates.length - references.length,
	}
}

export const formatBilibiliTextReference = (
	reference: BilibiliTextReference,
) => {
	if (reference.kind === 'short') return reference.url
	return `${reference.bvid}${reference.page ? ` · P${reference.page}` : ''}`
}
