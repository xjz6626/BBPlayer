import type { Track as OrpheusTrack } from '@bbplayer/orpheus'
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite'
import { ResultAsync, errAsync } from 'neverthrow'

import { api as bbplayerApi } from '@/lib/api/bbplayer/client'
import db from '@/lib/db/db'
import * as schema from '@/lib/db/schema'
import { createFacadeError } from '@/lib/errors/facade'
import { createValidationError } from '@/lib/errors/service'
import { artistService, type ArtistService } from '@/lib/services/artistService'
import {
	playlistService,
	type PlaylistService,
} from '@/lib/services/playlistService'
import { trackService, type TrackService } from '@/lib/services/trackService'
import { playlistSyncWorker } from '@/lib/workers/PlaylistSyncWorker'
import type { BilibiliTrack } from '@/types/core/media'
import type { CreateArtistPayload } from '@/types/services/artist'
import type {
	ReorderLocalPlaylistTrackPayload,
	UpdatePlaylistPayload,
} from '@/types/services/playlist'
import type { CreateTrackPayload } from '@/types/services/track'
import log from '@/utils/log'

type BbplayerApiClient = typeof bbplayerApi

const logger = log.extend('Facade')

const queueTrackToBilibiliPayload = (
	track: OrpheusTrack,
): CreateTrackPayload | null => {
	const [source, keyBvid, keyCid] = track.id.split('::')
	if (source !== 'bilibili') return null

	let urlBvid: string | null = null
	let urlCid: string | null = null
	try {
		const url = new URL(track.url)
		urlBvid = url.searchParams.get('bvid')
		urlCid = url.searchParams.get('cid')
	} catch {
		// The unique key still contains enough information for Bilibili tracks.
	}

	const bvid = keyBvid || urlBvid
	if (!bvid) return null

	const isMultiPage = keyCid !== undefined
	const rawCid = keyCid ?? urlCid
	const parsedCid = rawCid ? Number(rawCid) : undefined
	const cid =
		parsedCid !== undefined && Number.isFinite(parsedCid) && parsedCid > 0
			? parsedCid
			: undefined
	if (isMultiPage && cid === undefined) return null
	const duration = Number.isFinite(track.duration)
		? Math.max(0, Math.round(track.duration ?? 0))
		: 0

	return {
		title: track.title?.trim() || bvid,
		source: 'bilibili',
		artistId: null,
		coverUrl: track.artwork ?? null,
		duration,
		bilibiliMetadata: {
			bvid,
			cid,
			isMultiPage,
			videoIsValid: true,
		},
	}
}

export class PlaylistFacade {
	constructor(
		private readonly trackService: TrackService,
		private readonly playlistService: PlaylistService,
		private readonly artistService: ArtistService,
		private readonly db: ExpoSQLiteDatabase<typeof schema>,
		private readonly bbplayerApi: BbplayerApiClient,
	) {}

	/**
	 * 复制一份 playlist，新复制的 playlist 类型为 local，且 author&remoteSyncId 为 null
	 * @param playlistId remote playlist 的 ID
	 * @param name 新的 local playlist 的名称
	 * @returns 如果成功，则为 local playlist 的 ID
	 */
	public async duplicatePlaylist(playlistId: number, name: string) {
		logger.info('开始复制播放列表', { playlistId, name })
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)

				const playlist = await playlistSvc.getPlaylistById(playlistId)
				if (playlist.isErr()) {
					throw playlist.error
				}
				const playlistMetadata = playlist.value

				if (!playlistMetadata)
					throw createValidationError(`未找到播放列表：${playlistId}`)

				logger.debug('step1: 获取播放列表', playlistMetadata.id)

				const localPlaylistResult = await playlistSvc.createPlaylist({
					title: name,
					description: playlistMetadata.description,
					coverUrl: playlistMetadata.coverUrl,
					authorId: null,
					type: 'local',
					remoteSyncId: null,
				})
				if (localPlaylistResult.isErr()) {
					throw localPlaylistResult.error
				}
				const localPlaylist = localPlaylistResult.value
				logger.debug('step2: 创建本地播放列表', localPlaylist)
				logger.info('创建本地播放列表成功', {
					localPlaylistId: localPlaylist.id,
				})

				const tracksMetadata = await playlistSvc.getPlaylistTracks(playlistId)
				if (tracksMetadata.isErr()) {
					throw tracksMetadata.error
				}
				const finalIds = tracksMetadata.value
					.filter((t) => {
						if (t.source === 'bilibili' && !t.bilibiliMetadata.videoIsValid)
							return false
						return true
					})
					.map((t) => t.id)
				logger.debug(
					'step3: 获取播放列表中的所有歌曲并清洗完成（对于 bilibili 音频，去除掉失效视频）',
				)

				const replaceResult = await playlistSvc.replacePlaylistAllTracks(
					localPlaylist.id,
					finalIds,
				)
				if (replaceResult.isErr()) {
					throw replaceResult.error
				}
				logger.debug('step4: 替换本地播放列表中的所有歌曲')
				logger.info('复制播放列表成功', {
					sourcePlaylistId: playlistId,
					targetPlaylistId: localPlaylist.id,
					trackCount: finalIds.length,
				})

				return localPlaylist.id
			}),
			(e) =>
				createFacadeError('PlaylistDuplicateFailed', '复制播放列表失败', {
					cause: e,
				}),
		)
	}

	/**
	 * 创建动态合并歌单，读取时从源歌单实时展开并自动去重。
	 */
	public async mergePlaylists(sourcePlaylistIds: number[], title: string) {
		logger.info('开始创建动态合并播放列表', { sourcePlaylistIds, title })
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)

				const uniqueSourceIds = Array.from(new Set(sourcePlaylistIds))
				if (uniqueSourceIds.length < 2) {
					throw createValidationError(
						'动态合并歌单需要选择至少两个不同的源歌单',
					)
				}

				for (const playlistId of uniqueSourceIds) {
					const playlist = await playlistSvc.getPlaylistById(playlistId)
					if (playlist.isErr()) throw playlist.error
					if (!playlist.value) {
						throw createValidationError(`未找到播放列表：${playlistId}`)
					}
					if (playlist.value.type === 'dynamic') {
						throw createValidationError('动态合并歌单不能作为源歌单')
					}
				}

				const newPlaylistRes = await playlistSvc.createPlaylist({
					title,
					description: '动态合并歌单',
					type: 'dynamic',
					authorId: null,
					remoteSyncId: null,
				})
				if (newPlaylistRes.isErr()) throw newPlaylistRes.error
				const newPlaylist = newPlaylistRes.value

				await tx.insert(schema.dynamicPlaylistSources).values(
					uniqueSourceIds.map((sourcePlaylistId, position) => ({
						playlistId: newPlaylist.id,
						sourcePlaylistId,
						position,
					})),
				)

				logger.info('创建动态合并播放列表成功', {
					sourcePlaylistIds: uniqueSourceIds,
					newPlaylistId: newPlaylist.id,
				})

				return newPlaylist.id
			}),
			(e) =>
				createFacadeError('PlaylistMergeFailed', '创建动态合并播放列表失败', {
					cause: e,
				}),
		)
	}

	/**
	 * 更新某个 Track 在本地播放列表中的归属。
	 * - 如需要会自动创建 Artist，并把其 id 关联到 Track。
	 * - 若 Track 不存在会自动创建。
	 * @returns 更新后的 Track 的 ID
	 */
	public async updateTrackLocalPlaylists(params: {
		toAddPlaylistIds: number[]
		toRemovePlaylistIds: number[]
		trackPayload: CreateTrackPayload
		artistPayload?: CreateArtistPayload | null
	}) {
		const {
			toAddPlaylistIds,
			toRemovePlaylistIds,
			trackPayload,
			artistPayload,
		} = params

		logger.info('开始更新 Track 在本地播放列表', {
			toAdd: toAddPlaylistIds.length,
			toRemove: toRemovePlaylistIds.length,
			source: trackPayload.source,
			title: trackPayload.title,
		})
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)
				const trackSvc = this.trackService.withDB(tx)
				const artistSvc = this.artistService.withDB(tx)
				const targetPlaylists = new Map<
					number,
					typeof schema.playlists.$inferSelect
				>()

				// step0: 权限校验（所有目标歌单中，共享歌单仅 owner/editor 可写）
				const allTargetIds = [...toAddPlaylistIds, ...toRemovePlaylistIds]
				for (const pid of allTargetIds) {
					// oxlint-disable-next-line no-await-in-loop
					const res = await playlistSvc.getPlaylistById(pid)
					if (res.isErr()) throw res.error
					const pl = res.value
					if (!pl)
						throw createFacadeError(
							'PlaylistPermissionDenied',
							`未找到播放列表：${pid}`,
						)
					if (
						pl.shareId &&
						pl.shareRole !== 'owner' &&
						pl.shareRole !== 'editor'
					) {
						throw createFacadeError(
							'PlaylistPermissionDenied',
							'无权限修改此共享歌单',
						)
					}

					targetPlaylists.set(pid, pl)
				}

				// step1: 解析/创建 Artist（如需要）
				let finalArtistId: number | undefined =
					trackPayload.artistId ?? undefined
				if (finalArtistId === undefined && artistPayload) {
					const artistIdRes = await artistSvc.findOrCreateArtist(artistPayload)
					if (artistIdRes.isErr()) throw artistIdRes.error
					finalArtistId = artistIdRes.value.id
				}
				logger.debug('step1: 解析/创建 Artist 完成', finalArtistId ?? '(无)')

				// step2: 解析/创建 Track
				const trackRes = await trackSvc.findOrCreateTrack({
					...trackPayload,
					artistId: finalArtistId ?? undefined,
				})
				if (trackRes.isErr()) throw trackRes.error
				const trackId = trackRes.value.id
				logger.debug('step2: 解析/创建 Track 完成', trackId)

				// step3: 执行增删
				for (const pid of toAddPlaylistIds) {
					// oxlint-disable-next-line no-await-in-loop
					const r = await playlistSvc.addManyTracksToLocalPlaylist(pid, [
						trackId,
					])
					if (r.isErr()) throw r.error

					const target = targetPlaylists.get(pid)
					if (
						target?.shareId &&
						(target.shareRole === 'owner' || target.shareRole === 'editor')
					) {
						await this.enqueueSync(tx, pid, 'add_tracks', {
							trackIds: [trackId],
						})
					}
				}
				for (const pid of toRemovePlaylistIds) {
					// oxlint-disable-next-line no-await-in-loop
					const r = await playlistSvc.batchRemoveTracksFromLocalPlaylist(pid, [
						trackId,
					])
					if (r.isErr()) throw r.error

					const target = targetPlaylists.get(pid)
					if (
						target?.shareId &&
						(target.shareRole === 'owner' || target.shareRole === 'editor') &&
						r.value.removedTrackIds.length > 0
					) {
						await this.enqueueSync(tx, pid, 'remove_tracks', {
							removedTrackIds: r.value.removedTrackIds,
						})
					}
				}
				logger.debug('step3: 更新本地播放列表完成', {
					added: toAddPlaylistIds,
					removed: toRemovePlaylistIds,
				})

				logger.debug('更新 Track 在本地播放列表成功')
				logger.info('更新 Track 在本地播放列表成功', {
					trackId,
					added: toAddPlaylistIds.length,
					removed: toRemovePlaylistIds.length,
				})
				return trackId
			}),
			(e) =>
				createFacadeError(
					'UpdateTrackLocalPlaylistsFailed',
					'更新 Track 在本地播放列表失败',
					{ cause: e },
				),
		).map((res) => {
			playlistSyncWorker.triggerSync()
			return res
		})
	}

	/**
	 * 批量添加 tracks 到本地播放列表。
	 * 若歌单参与共享（owner/editor），在同一事务内将操作写入 playlistSyncQueue。
	 * @param playlistId
	 * @param payloads 应包含 track 和 artist，**artist 只能为 remote 来源**
	 */
	public async batchAddTracksToLocalPlaylist(
		playlistId: number,
		payloads: { track: CreateTrackPayload; artist: CreateArtistPayload }[],
	) {
		logger.info('开始批量添加 tracks 到本地播放列表', {
			playlistId,
			count: payloads.length,
		})
		for (const payload of payloads) {
			if (payload.artist.source === 'local') {
				return errAsync(
					createValidationError(
						'批量添加 tracks 到本地播放列表时，artist 只能为 remote 来源',
					),
				)
			}
		}
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)
				const trackSvc = this.trackService.withDB(tx)
				const artistSvc = this.artistService.withDB(tx)

				// step0: 权限校验（共享歌单仅 owner/editor 可写）
				const playlistRes = await playlistSvc.getPlaylistById(playlistId)
				if (playlistRes.isErr()) throw playlistRes.error
				const playlist = playlistRes.value
				if (!playlist)
					throw createFacadeError(
						'PlaylistPermissionDenied',
						`未找到播放列表：${playlistId}`,
					)
				const { shareId, shareRole } = playlist
				if (shareId && shareRole !== 'owner' && shareRole !== 'editor') {
					throw createFacadeError(
						'PlaylistPermissionDenied',
						'无权限修改此共享歌单',
					)
				}

				const artistResult = await artistSvc.findOrCreateManyRemoteArtists(
					payloads.map((p) => p.artist),
				)
				if (artistResult.isErr()) throw artistResult.error
				const artistMap = artistResult.value
				logger.debug('step1: 批量创建 artist 完成')

				const trackResult = await trackSvc.findOrCreateManyTracks(
					payloads.map((p) => ({
						...p.track,
						artistId: artistMap.get(p.artist.remoteId!)?.id,
					})),
					'bilibili',
				)
				if (trackResult.isErr()) throw trackResult.error
				const trackIds = Array.from(trackResult.value.values())
				logger.debug('step2: 批量创建 track 完成')

				const addResult = await playlistSvc.addManyTracksToLocalPlaylist(
					playlistId,
					trackIds,
				)
				if (addResult.isErr()) throw addResult.error
				logger.debug('step3: 批量将 track 添加到本地播放列表完成')

				// 若为共享歌单（owner/editor），在同一事务内入队
				if (shareId && (shareRole === 'owner' || shareRole === 'editor')) {
					await this.enqueueSync(tx, playlistId, 'add_tracks', { trackIds })
				}

				logger.info('批量添加 tracks 到本地播放列表成功', {
					playlistId,
					added: trackIds.length,
				})
				return trackIds
			}),
			(e) =>
				createFacadeError(
					'BatchAddTracksToLocalPlaylistFailed',
					'批量添加 tracks 到本地播放列表失败',
					{ cause: e },
				),
		).map((res) => {
			playlistSyncWorker.triggerSync()
			return res
		})
	}

	/**
	 * 将已经解析完成的 B 站歌曲原子地保存为一个新的本地播放列表。
	 */
	public async createPlaylistFromBilibiliTracks(params: {
		title: string
		description?: string | null
		tracks: BilibiliTrack[]
	}) {
		const title = params.title.trim()
		if (!title) return errAsync(createValidationError('播放列表名称不能为空'))
		if (params.tracks.length === 0) {
			return errAsync(createValidationError('没有可以导入的歌曲'))
		}

		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)
				const trackSvc = this.trackService.withDB(tx)
				const artistSvc = this.artistService.withDB(tx)

				const uniqueArtists = new Map<string, CreateArtistPayload>()
				for (const track of params.tracks) {
					if (!track.artist?.remoteId) continue
					uniqueArtists.set(track.artist.remoteId, {
						name: track.artist.name,
						source: 'bilibili',
						remoteId: track.artist.remoteId,
						avatarUrl: track.artist.avatarUrl,
						signature: track.artist.signature,
					})
				}

				const artistsResult = await artistSvc.findOrCreateManyRemoteArtists(
					Array.from(uniqueArtists.values()),
				)
				if (artistsResult.isErr()) throw artistsResult.error

				const trackPayloads: CreateTrackPayload[] = params.tracks.map(
					(track) => ({
						title: track.title,
						source: 'bilibili',
						artistId: track.artist?.remoteId
							? artistsResult.value.get(track.artist.remoteId)?.id
							: undefined,
						coverUrl: track.coverUrl,
						duration: track.duration,
						bilibiliMetadata: {
							bvid: track.bilibiliMetadata.bvid,
							cid: track.bilibiliMetadata.cid,
							isMultiPage: track.bilibiliMetadata.isMultiPage,
							videoIsValid: true,
							mainTrackTitle: track.bilibiliMetadata.mainTrackTitle,
						},
					}),
				)

				const tracksResult = await trackSvc.findOrCreateManyTracks(
					trackPayloads,
					'bilibili',
				)
				if (tracksResult.isErr()) throw tracksResult.error

				const trackIds = params.tracks.map((track) => {
					const trackId = tracksResult.value.get(track.uniqueKey)
					if (!trackId) {
						throw createValidationError(`歌曲入库失败：${track.title}`)
					}
					return trackId
				})

				const playlistResult = await playlistSvc.createPlaylist({
					title,
					description: params.description,
					coverUrl: params.tracks[0]?.coverUrl,
					type: 'local',
					authorId: null,
					remoteSyncId: null,
				})
				if (playlistResult.isErr()) throw playlistResult.error

				const addResult = await playlistSvc.addManyTracksToLocalPlaylist(
					playlistResult.value.id,
					trackIds,
				)
				if (addResult.isErr()) throw addResult.error

				return {
					playlistId: playlistResult.value.id,
					savedCount: addResult.value.length,
				}
			}),
			(error) =>
				createFacadeError('PlaylistCreateFailed', '从文本创建播放列表失败', {
					cause: error,
				}),
		)
	}

	/**
	 * 将播放队列保存为新的播放列表
	 * @param name 播放列表名称
	 * @param queueTracks 原生播放队列中的 tracks
	 */
	public async saveQueueAsPlaylist(name: string, queueTracks: OrpheusTrack[]) {
		logger.info('开始将队列保存为播放列表', {
			name,
			trackCount: queueTracks.length,
		})
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)
				const trackSvc = this.trackService.withDB(tx)

				// 1. 创建播放列表
				const playlistRes = await playlistSvc.createPlaylist({
					title: name,
					type: 'local',
					authorId: null,
					remoteSyncId: null,
				})
				if (playlistRes.isErr()) throw playlistRes.error
				const playlist = playlistRes.value

				// 2. 查询本地 tracks，并使用原生队列元数据修复历史遗留的未入库歌曲
				const distinctTracks = Array.from(
					new Map(queueTracks.map((track) => [track.id, track])).values(),
				)
				const distinctKeys = distinctTracks.map((track) => track.id)

				const findRes = await trackSvc.findTrackIdsByUniqueKeys(distinctKeys)
				if (findRes.isErr()) throw findRes.error
				const foundMap = findRes.value

				const trackIds: number[] = []
				const skippedKeys: string[] = []
				let recoveredCount = 0
				for (const queueTrack of distinctTracks) {
					const existingId = foundMap.get(queueTrack.id)
					if (existingId !== undefined) {
						trackIds.push(existingId)
						continue
					}

					const payload = queueTrackToBilibiliPayload(queueTrack)
					if (!payload) {
						logger.warning('无法从播放队列恢复未入库歌曲', {
							uniqueKey: queueTrack.id,
						})
						skippedKeys.push(queueTrack.id)
						continue
					}

					// oxlint-disable-next-line no-await-in-loop
					const repairResult = await trackSvc.findOrCreateTrack(payload)
					if (
						repairResult.isErr() ||
						repairResult.value.uniqueKey !== queueTrack.id
					) {
						logger.warning('恢复播放队列中的未入库歌曲失败', {
							uniqueKey: queueTrack.id,
							error: repairResult.isErr() ? repairResult.error : undefined,
						})
						skippedKeys.push(queueTrack.id)
						continue
					}

					trackIds.push(repairResult.value.id)
					recoveredCount += 1
				}

				if (trackIds.length === 0) {
					throw createValidationError('队列中没有可以保存的歌曲')
				}

				// 3. 批量添加到播放列表
				if (trackIds.length > 0) {
					const addRes = await playlistSvc.addManyTracksToLocalPlaylist(
						playlist.id,
						trackIds,
					)
					if (addRes.isErr()) throw addRes.error
				}

				return {
					playlistId: playlist.id,
					savedCount: trackIds.length,
					recoveredCount,
					skippedCount: skippedKeys.length,
					skippedKeys,
				}
			}),
			(e) =>
				createFacadeError('PlaylistCreateFailed', '保存队列为播放列表失败', {
					cause: e,
				}),
		)
	}

	/**
	 * 从本地播放列表批量移除曲目。
	 * 若歌单参与共享（owner/editor），在同一事务内将操作写入 playlistSyncQueue。
	 */
	public async removeTracksFromPlaylist(
		playlistId: number,
		trackIds: number[],
	) {
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)

				// 权限校验（共享歌单仅 owner/editor 可写）
				const playlistRes = await playlistSvc.getPlaylistById(playlistId)
				if (playlistRes.isErr()) throw playlistRes.error
				const playlist = playlistRes.value
				if (!playlist)
					throw createFacadeError(
						'PlaylistPermissionDenied',
						`未找到播放列表：${playlistId}`,
					)
				const { shareId, shareRole } = playlist
				if (shareId && shareRole !== 'owner' && shareRole !== 'editor') {
					throw createFacadeError(
						'PlaylistPermissionDenied',
						'无权限修改此共享歌单',
					)
				}

				const result = await playlistSvc.batchRemoveTracksFromLocalPlaylist(
					playlistId,
					trackIds,
				)
				if (result.isErr()) throw result.error

				// 若为共享歌单（owner/editor），在同一事务内入队
				if (shareId && (shareRole === 'owner' || shareRole === 'editor')) {
					await this.enqueueSync(tx, playlistId, 'remove_tracks', {
						removedTrackIds: result.value.removedTrackIds,
					})
				}

				return result.value
			}),
			(e) =>
				createFacadeError(
					'RemoveTracksFromPlaylistFailed',
					'从播放列表移除曲目失败',
					{ cause: e },
				),
		).map((res) => {
			playlistSyncWorker.triggerSync()
			return res
		})
	}

	/**
	 * 调整本地播放列表中单曲的位置。
	 * 若歌单参与共享（owner/editor），在同一事务内将操作写入 playlistSyncQueue。
	 */
	public async reorderLocalPlaylistTrack(
		playlistId: number,
		payload: ReorderLocalPlaylistTrackPayload,
	) {
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)

				// 权限校验（共享歌单仅 owner/editor 可写）
				const playlistRes = await playlistSvc.getPlaylistById(playlistId)
				if (playlistRes.isErr()) throw playlistRes.error
				const playlist = playlistRes.value
				if (!playlist)
					throw createFacadeError(
						'PlaylistPermissionDenied',
						`未找到播放列表：${playlistId}`,
					)
				const { shareId, shareRole } = playlist
				if (shareId && shareRole !== 'owner' && shareRole !== 'editor') {
					throw createFacadeError(
						'PlaylistPermissionDenied',
						'无权限修改此共享歌单',
					)
				}

				const result = await playlistSvc.reorderSingleLocalPlaylistTrack(
					playlistId,
					payload,
				)
				if (result.isErr()) throw result.error

				// 若为共享歌单（owner/editor），在同一事务内入队
				if (shareId && (shareRole === 'owner' || shareRole === 'editor')) {
					await this.enqueueSync(tx, playlistId, 'reorder_track', {
						trackId: payload.trackId,
						prevSortKey: payload.prevSortKey,
						nextSortKey: payload.nextSortKey,
					})
				}

				return result.value
			}),
			(e) =>
				createFacadeError(
					'ReorderPlaylistTrackFailed',
					'调整播放列表曲目顺序失败',
					{ cause: e },
				),
		).map((res) => {
			playlistSyncWorker.triggerSync()
			return res
		})
	}

	/**
	 * 更新播放列表元数据（标题/描述/封面）。
	 * 若歌单参与共享（owner/editor），在同一事务内将操作写入 playlistSyncQueue。
	 */
	public async updatePlaylistMetadata(
		playlistId: number,
		payload: UpdatePlaylistPayload,
	) {
		return ResultAsync.fromPromise(
			this.db.transaction(async (tx) => {
				const playlistSvc = this.playlistService.withDB(tx)

				// 权限校验（共享歌单仅 owner/editor 可写）
				const playlistRes = await playlistSvc.getPlaylistById(playlistId)
				if (playlistRes.isErr()) throw playlistRes.error
				const playlist = playlistRes.value
				if (!playlist)
					throw createFacadeError(
						'PlaylistPermissionDenied',
						`未找到播放列表：${playlistId}`,
					)
				const { shareId, shareRole } = playlist
				if (shareId && shareRole !== 'owner' && shareRole !== 'editor') {
					throw createFacadeError(
						'PlaylistPermissionDenied',
						'无权限修改此共享歌单',
					)
				}

				const nextTitle = payload.title ?? playlist.title
				const nextDescription =
					payload.description ?? playlist.description ?? null
				const nextCoverUrl = payload.coverUrl ?? playlist.coverUrl ?? null

				const result = await playlistSvc.updatePlaylistMetadata(
					playlistId,
					payload,
				)
				if (result.isErr()) throw result.error

				// 若为共享歌单（owner/editor），在同一事务内入队
				if (shareId && (shareRole === 'owner' || shareRole === 'editor')) {
					await this.enqueueSync(tx, playlistId, 'update_metadata', {
						title: nextTitle,
						description: nextDescription,
						coverUrl: nextCoverUrl,
					})
				}

				return result.value
			}),
			(e) =>
				createFacadeError(
					'UpdatePlaylistMetadataFailed',
					'更新播放列表元数据失败',
					{ cause: e },
				),
		).map((res) => {
			playlistSyncWorker.triggerSync()
			return res
		})
	}

	/**
	 * 删除播放列表，按 shareRole 路由到不同的删除策略：
	 * - local（无 shareId）：直接删除本地数据
	 * - subscriber：服务端解除成员关系 + 删除本地副本
	 * - editor：服务端解除成员关系 + 清空 shareId/shareRole（保留本地数据转为普通 local 歌单）
	 * - owner：服务端软删除共享歌单 + 删除本地副本
	 */
	public async deletePlaylist(playlistId: number) {
		const playlistRes = await this.playlistService.getPlaylistById(playlistId)
		if (playlistRes.isErr()) {
			return errAsync(
				createFacadeError('PlaylistDeleteFailed', '读取播放列表失败', {
					cause: playlistRes.error,
				}),
			)
		}
		const playlist = playlistRes.value
		if (!playlist) {
			return errAsync(
				createFacadeError(
					'PlaylistDeleteFailed',
					`未找到播放列表：${playlistId}`,
				),
			)
		}

		const { shareId, shareRole } = playlist

		// local 直接删除本地，无需鉴权或网络请求
		if (!shareId) {
			return this.playlistService
				.deletePlaylist(playlistId)
				.map(() => undefined)
				.mapErr((e) =>
					createFacadeError('PlaylistDeleteFailed', '删除播放列表失败', {
						cause: e,
					}),
				)
		}

		return ResultAsync.fromPromise(
			(async () => {
				if (shareRole === 'owner') {
					// owner：服务端软删除，然后删除本地副本
					const resp = await this.bbplayerApi.playlists[':id'].$delete({
						param: { id: shareId },
					})
					if (!resp.ok && resp.status !== 404 && resp.status !== 403) {
						const body = await resp.json().catch(() => ({}))
						throw createFacadeError(
							'PlaylistDeleteFailed',
							`删除共享歌单失败（${resp.status}）`,
							{ cause: body },
						)
					}
					if (resp.status === 404 || resp.status === 403) {
						logger.warning('远端歌单已不存在或权限丢失，跳过云端删除', {
							playlistId,
							shareId,
						})
					}
					const deleteRes =
						await this.playlistService.deletePlaylist(playlistId)
					if (deleteRes.isErr()) throw deleteRes.error
				} else if (shareRole === 'subscriber' || shareRole === 'editor') {
					// subscriber/editor：服务端解除成员关系
					const resp = await this.bbplayerApi.playlists[
						':id'
					].members.me.$delete({
						param: { id: shareId },
					})
					if (!resp.ok && resp.status !== 404 && resp.status !== 403) {
						const body = await resp.json().catch(() => ({}))
						throw createFacadeError(
							'PlaylistDeleteFailed',
							`解除共享歌单关联失败（${resp.status}）`,
							{ cause: body },
						)
					}
					if (resp.status === 404 || resp.status === 403) {
						logger.warning(
							'远端歌单已被删除或已解除成员关系，继续清理本地关联',
							{
								playlistId,
								shareId,
							},
						)
					}

					await this.db.transaction(async (tx) => {
						const txPlaylist = this.playlistService.withDB(tx)
						if (shareRole === 'subscriber') {
							// subscriber：删除本地副本
							const r = await txPlaylist.deletePlaylist(playlistId)
							if (r.isErr()) throw r.error
						} else {
							// editor：保留本地数据，仅断开共享连接
							const r = await txPlaylist.updatePlaylistMetadata(playlistId, {
								shareId: null,
								shareRole: null,
								lastShareSyncAt: null,
							})
							if (r.isErr()) throw r.error
						}
					})
				}
			})(),
			(e) =>
				createFacadeError('PlaylistDeleteFailed', '删除播放列表失败', {
					cause: e,
				}),
		)
	}

	/**
	 * 向 playlist_sync_queue 写入一条待同步记录（在调用方的事务内执行）。
	 * operationAt 记录用户真正执行操作的时间（LWW 基准）。
	 */
	private async enqueueSync(
		db: ExpoSQLiteDatabase<typeof schema>,
		playlistId: number,
		operation: (typeof schema.playlistSyncQueue.$inferInsert)['operation'],
		payload: Record<string, unknown>,
	): Promise<void> {
		await db.insert(schema.playlistSyncQueue).values({
			playlistId,
			operation,
			payload: JSON.stringify(payload),
			operationAt: new Date(Date.now()),
		})
	}
}

export const playlistFacade = new PlaylistFacade(
	trackService,
	playlistService,
	artistService,
	db,
	bbplayerApi,
)
