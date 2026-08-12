import { bilibiliApi } from '@/lib/api/bilibili/api'
import type { BilibiliTrack } from '@/types/core/media'
import {
	mapBilibiliVideoDetailsToTrack,
	mapBilibiliVideoPageToTrack,
} from '@/utils/bilibili-track'
import {
	formatBilibiliTextReference,
	parseBilibiliTextReferences,
	parseBilibiliVideoUrl,
	type BilibiliTextReference,
	type BilibiliVideoTextReference,
} from '@/utils/bilibiliTextPlaylist'

export interface BilibiliTextImportFailure {
	reference: string
	reason: string
}

export interface BilibiliTextImportProgress {
	completed: number
	total: number
}

export interface BilibiliTextResolveResult {
	tracks: BilibiliTrack[]
	failures: BilibiliTextImportFailure[]
	recognizedCount: number
	duplicateCount: number
}

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error)

const resolveShortReference = async (
	reference: BilibiliTextReference,
	signal?: AbortSignal,
): Promise<BilibiliVideoTextReference> => {
	if (reference.kind === 'video') return reference

	const response = await fetch(reference.url, {
		method: 'GET',
		redirect: 'follow',
		signal,
	})
	if (!response.ok) {
		throw new Error(`短链接访问失败（HTTP ${response.status}）`)
	}

	const resolved = parseBilibiliVideoUrl(response.url, reference.index)
	if (!resolved) throw new Error('短链接没有跳转到 B 站视频')
	return { ...resolved, raw: reference.raw }
}

const resolveReferenceTrack = async (
	reference: BilibiliTextReference,
	signal?: AbortSignal,
) => {
	const videoReference = await resolveShortReference(reference, signal)
	const detailsResult = await bilibiliApi.getVideoDetails({
		bvid: videoReference.bvid,
		signal,
	})
	if (detailsResult.isErr()) throw detailsResult.error

	const video = detailsResult.value
	if (videoReference.page === undefined) {
		return mapBilibiliVideoDetailsToTrack(video)
	}

	const page = video.pages[videoReference.page - 1]
	if (!page) {
		throw new Error(
			`视频只有 ${video.pages.length} 个分 P，找不到 P${videoReference.page}`,
		)
	}

	return video.pages.length > 1
		? mapBilibiliVideoPageToTrack(page, video)
		: mapBilibiliVideoDetailsToTrack(video)
}

const createAbortError = () => {
	const error = new Error('导入已取消')
	error.name = 'AbortError'
	return error
}

export const bilibiliTextPlaylistImportService = {
	async resolve(
		text: string,
		options: {
			signal?: AbortSignal
			onProgress?: (progress: BilibiliTextImportProgress) => void
			concurrency?: number
		} = {},
	): Promise<BilibiliTextResolveResult> {
		const parsed = parseBilibiliTextReferences(text)
		const { references } = parsed
		const tracksByIndex = new Array<BilibiliTrack | undefined>(
			references.length,
		)
		const failuresByIndex = new Array<BilibiliTextImportFailure | undefined>(
			references.length,
		)
		let cursor = 0
		let completed = 0

		options.onProgress?.({ completed: 0, total: references.length })

		const worker = async () => {
			while (cursor < references.length && !options.signal?.aborted) {
				const currentIndex = cursor
				cursor += 1
				const reference = references[currentIndex]
				try {
					tracksByIndex[currentIndex] = await resolveReferenceTrack(
						reference,
						options.signal,
					)
				} catch (error) {
					if (options.signal?.aborted) break
					failuresByIndex[currentIndex] = {
						reference: formatBilibiliTextReference(reference),
						reason: errorMessage(error),
					}
				} finally {
					completed += 1
					options.onProgress?.({ completed, total: references.length })
				}
			}
		}

		const concurrency = Math.max(
			1,
			Math.min(options.concurrency ?? 3, references.length || 1),
		)
		await Promise.all(Array.from({ length: concurrency }, worker))

		if (options.signal?.aborted) throw createAbortError()

		const seenTracks = new Set<string>()
		let resolvedDuplicateCount = 0
		const tracks = tracksByIndex.filter((track): track is BilibiliTrack => {
			if (!track) return false
			if (seenTracks.has(track.uniqueKey)) {
				resolvedDuplicateCount += 1
				return false
			}
			seenTracks.add(track.uniqueKey)
			return true
		})

		return {
			tracks,
			failures: failuresByIndex.filter(
				(failure): failure is BilibiliTextImportFailure => !!failure,
			),
			recognizedCount: references.length,
			duplicateCount: parsed.duplicateCount + resolvedDuplicateCount,
		}
	},
}
