import { Orpheus, type Track as OrpheusTrack } from '@bbplayer/orpheus'
import { create } from 'zustand'

import { trackService } from '@/lib/services/trackService'
import type { Track } from '@/types/core/media'
import log from '@/utils/log'

const logger = log.extend('Store.Player')

const createFallbackTrack = (track: OrpheusTrack): Track | null => {
	try {
		const url = new URL(track.url)
		if (url.protocol !== 'orpheus:' || url.hostname !== 'bilibili') return null
		const bvid = url.searchParams.get('bvid')
		if (!bvid) return null
		const cidParam = url.searchParams.get('cid')
		const parsedCid = cidParam ? Number(cidParam) : null
		const cid = Number.isFinite(parsedCid) ? parsedCid : null
		const uniqueKey = track.id
		return {
			id: -1,
			uniqueKey,
			source: 'bilibili',
			title: track.title ?? '未知曲目',
			artist: track.artist
				? {
						id: -1,
						name: track.artist,
						source: 'bilibili',
						createdAt: new Date(),
						updatedAt: new Date(),
					}
				: null,
			coverUrl: track.artwork ?? null,
			duration: track.duration ?? 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			bilibiliMetadata: {
				bvid,
				cid,
				isMultiPage: cid !== null,
				videoIsValid: true,
			},
		}
	} catch {
		return null
	}
}

interface PlayerState {
	orpheusTrack: OrpheusTrack | null
	internalTrack: Track | null
	currentIndex: number

	initialize: () => void
	sync: () => Promise<void>
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
	orpheusTrack: null,
	internalTrack: null,
	currentIndex: -1,

	initialize: () => {
		void get().sync()

		Orpheus.addListener('onTrackStarted', async () => {
			await get().sync()
		})
	},

	sync: async () => {
		try {
			const [currentTrack, currentIndex] = await Promise.all([
				Orpheus.getCurrentTrack(),
				Orpheus.getCurrentIndex(),
			])

			const currentInternalTrackId = get().internalTrack?.uniqueKey
			const newTrackId = currentTrack?.id

			set({ orpheusTrack: currentTrack, currentIndex })

			if (!currentTrack) {
				set({ internalTrack: null })
				return
			}

			if (newTrackId !== currentInternalTrackId) {
				const result = await trackService.getTrackByUniqueKey(currentTrack.id)

				if (get().orpheusTrack?.id !== newTrackId) return

				if (result.isErr()) {
					const fallbackTrack = createFallbackTrack(currentTrack)
					if (fallbackTrack) {
						set({ internalTrack: fallbackTrack })
						logger.warning('读取当前曲目信息失败，已使用播放器队列信息回退', {
							trackId: currentTrack.id,
							error: result.error,
						})
						return
					}
					logger.warning('读取当前曲目信息失败，保留上一首曲目信息', {
						trackId: currentTrack.id,
						error: result.error,
					})
					return
				}
				set({ internalTrack: result.value })
			}
		} catch (e) {
			logger.warning('Failed to sync player state', { error: e })
		}
	},
}))

export default usePlayerStore
