import { bilibiliApi } from '@/lib/api/bilibili/api'
import type {
	BilibiliRecommendationItem,
	BilibiliVideoDetails,
} from '@/types/apis/bilibili'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'

const MUSIC_ZONE_IDS = new Set([
	3, 28, 29, 30, 31, 54, 59, 130, 193, 194, 243, 244, 265, 266, 267,
])
const DETAIL_CONCURRENCY = 6

export interface BilibiliMusicRecommendation {
	detail: BilibiliVideoDetails
	badges: string[]
}

const isMusicVideo = (video: BilibiliVideoDetails) =>
	(video.tid !== undefined && MUSIC_ZONE_IDS.has(video.tid)) ||
	video.tname?.includes('音乐') === true ||
	video.tname === 'MV' ||
	video.tname === 'VOCALOID·UTAU'

const getBadges = (
	source: BilibiliRecommendationItem | undefined,
	detail: BilibiliVideoDetails,
) => {
	const badges: string[] = []
	if (source?.is_followed === 1) badges.push('关注UP')
	if (detail.tid === 30) badges.push('V·U')
	return badges
}

export const getBilibiliMusicRecommendations = async ({
	freshIndex,
	pageSize = 20,
	signal,
}: {
	freshIndex: number
	pageSize?: number
	signal?: AbortSignal
}): Promise<BilibiliMusicRecommendation[]> => {
	const feed = await returnOrThrowAsync(
		bilibiliApi.getRecommendationFeed({ freshIndex, pageSize, signal }),
	)
	const candidates = feed.item.filter(
		(item): item is BilibiliRecommendationItem & { bvid: string } =>
			item.goto === 'av' && typeof item.bvid === 'string',
	)
	const sourceByBvid = new Map(candidates.map((item) => [item.bvid, item]))
	const details: BilibiliVideoDetails[] = []

	for (let index = 0; index < candidates.length; index += DETAIL_CONCURRENCY) {
		const batch = candidates.slice(index, index + DETAIL_CONCURRENCY)
		const results = await Promise.allSettled(
			batch.map((item) =>
				returnOrThrowAsync(
					bilibiliApi.getVideoDetails({ bvid: item.bvid, signal }),
				),
			),
		)
		for (const result of results) {
			if (result.status === 'fulfilled') details.push(result.value)
		}
	}

	return details.filter(isMusicVideo).map((detail) => ({
		detail,
		badges: getBadges(sourceByBvid.get(detail.bvid), detail),
	}))
}
