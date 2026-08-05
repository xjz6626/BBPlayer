import { bv2av } from '@/lib/api/bilibili/utils'
import type {
	BilibiliDynamicArchive,
	BilibiliDynamicAuthor,
	BilibiliDynamicItem,
} from '@/types/apis/bilibili'
import type { BilibiliTrack } from '@/types/core/media'
import { parseDurationString } from '@/utils/time'

export interface BilibiliDynamicArchiveSource {
	archive: BilibiliDynamicArchive
	author: BilibiliDynamicAuthor
}

const normalizeUrl = (url: string) => {
	if (url.startsWith('//')) return `https:${url}`
	if (url.startsWith('http:')) return url.replace('http:', 'https:')
	return url
}

export const getBilibiliDynamicArchiveSource = (
	item: BilibiliDynamicItem,
): BilibiliDynamicArchiveSource | null => {
	const archive = item.modules.module_dynamic.major?.archive
	if (archive) {
		return { archive, author: item.modules.module_author }
	}
	return item.orig ? getBilibiliDynamicArchiveSource(item.orig) : null
}

export const mapBilibiliDynamicItemToTrack = (
	item: BilibiliDynamicItem,
): BilibiliTrack | null => {
	const source = getBilibiliDynamicArchiveSource(item)
	if (!source) return null

	const { archive, author } = source
	const date = new Date(author.pub_ts * 1000)
	const aid = Number(archive.aid) || bv2av(archive.bvid)

	return {
		id: aid,
		uniqueKey: `bilibili::${archive.bvid}`,
		source: 'bilibili',
		title: archive.title,
		artist: {
			id: author.mid,
			name: author.name,
			remoteId: author.mid.toString(),
			source: 'bilibili',
			avatarUrl: normalizeUrl(author.face),
			createdAt: date,
			updatedAt: date,
		},
		coverUrl: normalizeUrl(archive.cover),
		duration: parseDurationString(archive.duration_text),
		createdAt: date,
		updatedAt: date,
		bilibiliMetadata: {
			bvid: archive.bvid,
			cid: null,
			isMultiPage: false,
			videoIsValid: true,
		},
	}
}
