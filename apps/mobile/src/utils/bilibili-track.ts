import type { BilibiliVideoDetails } from '@/types/apis/bilibili'
import type { BilibiliTrack } from '@/types/core/media'

const normalizeCoverUrl = (url: string) =>
	url.startsWith('//') ? `https:${url}` : url

export const mapBilibiliVideoDetailsToTrack = (
	video: BilibiliVideoDetails,
): BilibiliTrack => {
	const timestamp = video.pubdate * 1000
	const date = new Date(timestamp)
	const isMultiPage = video.pages.length > 1

	return {
		id: video.aid,
		uniqueKey: isMultiPage
			? `bilibili::${video.bvid}::${video.cid}`
			: `bilibili::${video.bvid}`,
		source: 'bilibili',
		title: video.title,
		artist: {
			id: video.owner.mid,
			name: video.owner.name,
			remoteId: video.owner.mid.toString(),
			source: 'bilibili',
			avatarUrl: normalizeCoverUrl(video.owner.face),
			createdAt: date,
			updatedAt: date,
		},
		coverUrl: normalizeCoverUrl(video.pic),
		duration: video.duration,
		createdAt: date,
		updatedAt: date,
		bilibiliMetadata: {
			bvid: video.bvid,
			cid: video.cid,
			isMultiPage,
			videoIsValid: true,
		},
	}
}

export const mapBilibiliVideoPageToTrack = (
	page: BilibiliVideoDetails['pages'][number],
	video: BilibiliVideoDetails,
): BilibiliTrack => {
	const date = new Date(video.pubdate * 1000)

	return {
		id: page.cid,
		uniqueKey: `bilibili::${video.bvid}::${page.cid}`,
		source: 'bilibili',
		title: page.part,
		artist: {
			id: video.owner.mid,
			name: video.owner.name,
			remoteId: video.owner.mid.toString(),
			source: 'bilibili',
			avatarUrl: normalizeCoverUrl(video.owner.face),
			createdAt: date,
			updatedAt: date,
		},
		coverUrl: normalizeCoverUrl(video.pic),
		duration: page.duration,
		createdAt: date,
		updatedAt: date,
		bilibiliMetadata: {
			bvid: video.bvid,
			cid: page.cid,
			isMultiPage: true,
			videoIsValid: true,
			mainTrackTitle: video.title,
		},
	}
}
