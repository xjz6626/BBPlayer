import { Icon } from '@expo/ui'
import { usePathname, useRouter } from 'expo-router'
import { useCallback } from 'react'

import { useAddToDefaultFavorite } from '@/hooks/mutations/bilibili/favorite'
import { usePersonalInformation } from '@/hooks/queries/bilibili/user'
import { useModalStore } from '@/hooks/stores/useModalStore'
import type { BilibiliTrack } from '@/types/core/media'
import toast from '@/utils/toast'

const PLAY_NEXT_ICON = Icon.select({
	ios: 'arrow.right.to.line.circle',
	android: import('@expo/material-symbols/skip_next.xml'),
})

const INFO_ICON = Icon.select({
	ios: 'doc.text',
	android: import('@expo/material-symbols/description.xml'),
})

const ADD_TO_PLAYLIST_ICON = Icon.select({
	ios: 'plus.rectangle.on.rectangle',
	android: import('@expo/material-symbols/playlist_add.xml'),
})

const ARTIST_ICON = Icon.select({
	ios: 'person.crop.circle',
	android: import('@expo/material-symbols/person.xml'),
})

const FAVORITE_ICON = Icon.select({
	ios: 'star',
	android: import('@expo/material-symbols/bookmark_star.xml'),
})

export function usePlaylistMenu(
	playTrack: (track: BilibiliTrack, playNext: boolean) => void,
) {
	const router = useRouter()
	const pathname = usePathname()
	const openModal = useModalStore((state) => state.open)
	const { data: personalInformation } = usePersonalInformation()
	const { mutate: addToDefaultFavorite } = useAddToDefaultFavorite()

	return useCallback(
		(item: BilibiliTrack) => [
			{
				title: '下一首播放',
				leadingIcon: PLAY_NEXT_ICON,
				onPress: () => {
					playTrack(item, true)
					toast.success('添加到下一首播放成功')
				},
			},
			{
				title: '查看详细信息',
				leadingIcon: INFO_ICON,
				onPress: () => {
					if (pathname.includes('multipage')) {
						toast.info('你已经在这里了，没法更深入了！')
						return
					}
					router.navigate({
						pathname: '/playlist/remote/multipage/[bvid]',
						params: { bvid: item.bilibiliMetadata.bvid },
					})
				},
			},
			{
				title: '收藏到默认收藏夹',
				leadingIcon: FAVORITE_ICON,
				onPress: () => {
					if (!personalInformation?.mid) {
						toast.info('请先登录 B 站账号')
						return
					}
					addToDefaultFavorite({
						bvid: item.bilibiliMetadata.bvid,
						userMid: personalInformation.mid,
					})
				},
			},
			{
				title: '添加到本地歌单',
				leadingIcon: ADD_TO_PLAYLIST_ICON,
				onPress: () => {
					openModal('UpdateTrackLocalPlaylists', { track: item })
				},
			},
			{
				title: '查看 up 主作品',
				leadingIcon: ARTIST_ICON,
				onPress: () => {
					if (!item.artist?.remoteId) {
						toast.error('未找到 up 主信息')
						return
					}
					router.navigate({
						pathname: '/playlist/remote/uploader/[mid]',
						params: { mid: item.artist?.remoteId },
					})
				},
			},
		],
		[
			router,
			openModal,
			playTrack,
			pathname,
			personalInformation,
			addToDefaultFavorite,
		],
	)
}
