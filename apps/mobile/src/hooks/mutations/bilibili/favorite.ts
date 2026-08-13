import { useMutation, useQueryClient } from '@tanstack/react-query'

import { favoriteListQueryKeys } from '@/hooks/queries/bilibili/favorite'
import { bilibiliApi } from '@/lib/api/bilibili/api'
import { BilibiliApiError } from '@/lib/errors/thirdparty/bilibili'
import { syncLocalToBilibiliService } from '@/lib/services/syncLocalToBilibiliService'
import { toastAndLogError } from '@/utils/error-handling'
import log from '@/utils/log'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'
import toast from '@/utils/toast'

const logger = log.extend('Mutation.Bilibili.Favorite')

/**
 * 单个视频添加/删除到多个收藏夹
 */
export const useDealFavoriteForOneVideo = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (params: {
			bvid: string
			addToFavoriteIds: string[]
			delInFavoriteIds: string[]
		}) =>
			await returnOrThrowAsync(
				bilibiliApi.dealFavoriteForOneVideo({
					bvid: params.bvid,
					addToFavoriteIds: params.addToFavoriteIds,
					delInFavoriteIds: params.delInFavoriteIds,
				}),
			),
		onSuccess: async (_data, _value) => {
			toast.success('操作成功', {
				description:
					_data.toast_msg.length > 0
						? `api 返回消息：${_data.toast_msg}`
						: undefined,
			})
			// 只刷新当前显示的收藏夹
			await queryClient.refetchQueries({
				queryKey: ['bilibili', 'favoriteList', 'infiniteFavoriteList'],
				type: 'active',
			})
			await queryClient.invalidateQueries({
				queryKey: [
					...favoriteListQueryKeys.all,
					'favoriteForOneVideo',
					_value.bvid,
				],
			})
		},
		onError: (error) => {
			let errorMessage = '删除失败，请稍后重试'
			if (error instanceof BilibiliApiError) {
				if (error.type === 'CsrfError') {
					errorMessage = '删除失败：csrf token 过期，请检查 cookie 后重试'
				} else {
					errorMessage = `删除失败：${error.message} (${error.data.msgCode})`
				}
			}

			toast.error('操作失败', {
				description: errorMessage,
				duration: Number.POSITIVE_INFINITY,
			})
			logger.error('删除收藏夹内容失败:', error)
		},
	})
}

/**
 * 一键切换视频在默认收藏夹中的状态
 */
export const useToggleDefaultFavorite = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			bvid,
			folderId,
			favorite,
		}: {
			bvid: string
			folderId: number
			favorite: boolean
		}) =>
			returnOrThrowAsync(
				bilibiliApi
					.dealFavoriteForOneVideo({
						bvid,
						addToFavoriteIds: favorite ? [String(folderId)] : [],
						delInFavoriteIds: favorite ? [] : [String(folderId)],
					})
					.map(() => true),
			),
		onSuccess: (_data, { favorite }) => {
			toast.success(favorite ? '已收藏到默认收藏夹' : '已取消默认收藏')
		},
		onError: (error, { favorite }) => {
			toastAndLogError(
				favorite ? '收藏失败' : '取消收藏失败',
				error,
				'Mutation.Bilibili.Favorite',
			)
		},
		onSettled: async (_data, _error, { bvid }, _result) => {
			await queryClient.invalidateQueries({
				queryKey: [...favoriteListQueryKeys.all, 'favoriteForOneVideo', bvid],
			})
		},
	})
}

/**
 * 列表菜单使用的一键收藏操作，只添加、不切换状态
 */
export const useAddToDefaultFavorite = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({
			bvid,
			userMid,
		}: {
			bvid: string
			userMid: number
		}) => {
			const folders = await returnOrThrowAsync(
				bilibiliApi.getTargetVideoFavoriteStatus({ userMid, bvid }),
			)
			const defaultFolder =
				folders.find((folder) => ((folder.attr ?? 0) >> 1) % 2 === 0) ??
				folders[0]
			if (!defaultFolder) throw new Error('还没有可用的收藏夹')
			if (defaultFolder.fav_state === 1) {
				return { alreadyFavorite: true, folderTitle: defaultFolder.title }
			}

			await returnOrThrowAsync(
				bilibiliApi.dealFavoriteForOneVideo({
					bvid,
					addToFavoriteIds: [String(defaultFolder.id)],
					delInFavoriteIds: [],
				}),
			)
			return { alreadyFavorite: false, folderTitle: defaultFolder.title }
		},
		onSuccess: ({ alreadyFavorite, folderTitle }) => {
			toast.success(
				alreadyFavorite
					? `已经在「${folderTitle}」中`
					: `已收藏到「${folderTitle}」`,
			)
		},
		onError: (error) => {
			toastAndLogError('收藏失败', error, 'Mutation.Bilibili.Favorite')
		},
		onSettled: async (_data, _error, { bvid }) => {
			await queryClient.invalidateQueries({
				queryKey: [...favoriteListQueryKeys.all, 'favoriteForOneVideo', bvid],
			})
		},
	})
}

/**
 * 将多个视频添加到登录用户的默认收藏夹。
 * 重复或已在收藏夹中的视频会被跳过。
 */
export const useBatchAddToDefaultFavorite = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({
			bvids,
			userMid,
		}: {
			bvids: string[]
			userMid: number
		}) => {
			const uniqueBvids = Array.from(new Set(bvids))
			const folders = await returnOrThrowAsync(
				bilibiliApi.getFavoritePlaylists({ userMid }),
			)
			const defaultFolder =
				folders.find((folder) => ((folder.attr ?? 0) >> 1) % 2 === 0) ??
				folders[0]
			if (!defaultFolder) throw new Error('还没有可用的收藏夹')

			const favoriteContents = await returnOrThrowAsync(
				bilibiliApi.getFavoriteListAllContents({
					favoriteId: defaultFolder.id,
				}),
			)
			const existingBvids = new Set(favoriteContents.map((item) => item.bvid))
			const bvidsToAdd = uniqueBvids.filter((bvid) => !existingBvids.has(bvid))

			const batchResult = await syncLocalToBilibiliService.executeBatchAdd(
				defaultFolder.id,
				bvidsToAdd,
			)
			if (batchResult.isErr()) throw batchResult.error

			const failedCount = batchResult.value
			return {
				folderTitle: defaultFolder.title,
				totalCount: uniqueBvids.length,
				alreadyFavoriteCount: uniqueBvids.length - bvidsToAdd.length,
				successCount: bvidsToAdd.length - failedCount,
				failedCount,
			}
		},
		onSuccess: async ({
			folderTitle,
			totalCount,
			alreadyFavoriteCount,
			successCount,
			failedCount,
		}) => {
			if (failedCount > 0) {
				toast.info('批量收藏完成，但有部分视频失败', {
					description: `成功 ${successCount} 个，失败 ${failedCount} 个`,
				})
			} else if (alreadyFavoriteCount === totalCount) {
				toast.success(`队列中的视频都已在「${folderTitle}」中`)
			} else {
				toast.success(`已收藏 ${successCount} 个视频到「${folderTitle}」`, {
					description:
						alreadyFavoriteCount > 0
							? `${alreadyFavoriteCount} 个视频已在收藏夹中，已跳过`
							: undefined,
				})
			}

			await queryClient.invalidateQueries({
				queryKey: favoriteListQueryKeys.all,
			})
		},
		onError: (error) => {
			toastAndLogError('批量收藏失败', error, 'Mutation.Bilibili.Favorite')
		},
	})
}

/**
 * 删除收藏夹内容
 */
export const useBatchDeleteFavoriteListContents = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (params: { bvids: string[]; favoriteId: number }) =>
			returnOrThrowAsync(
				bilibiliApi.batchDeleteFavoriteListContents({
					favoriteId: params.favoriteId,
					bvids: params.bvids,
				}),
			),
		onSuccess: async (_data, variables) => {
			toast.success('删除成功')
			await queryClient.refetchQueries({
				queryKey: favoriteListQueryKeys.infiniteFavoriteList(
					variables.favoriteId,
				),
			})
		},
		onError: (error) => {
			let errorMessage = '删除失败，请稍后重试'
			if (error instanceof BilibiliApiError) {
				if (error.type === 'CsrfError') {
					errorMessage = '删除失败：csrf token 过期，请检查 cookie 后重试'
				} else {
					errorMessage = `删除失败：${error.message} (${error.data.msgCode})`
				}
			}

			toastAndLogError(errorMessage, error, 'Query.Bilibili.Favorite')
		},
	})
}
