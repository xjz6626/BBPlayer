import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Appbar, Text, useTheme } from 'react-native-paper'

import ThemedRefreshControl, {
	ThemedRefreshIndicator,
} from '@/components/theme/ThemedRefreshControl'
import { PlaylistError } from '@/features/playlist/remote/components/PlaylistError'
import { TrackList } from '@/features/playlist/remote/components/RemoteTrackList'
import { usePlaylistMenu } from '@/features/playlist/remote/hooks/usePlaylistMenu'
import { useRemotePlaylist } from '@/features/playlist/remote/hooks/useRemotePlaylist'
import { useTrackSelection } from '@/features/playlist/remote/hooks/useTrackSelection'
import { PlaylistPageSkeleton } from '@/features/playlist/skeletons/PlaylistSkeleton'
import { useBilibiliMusicRecommendations } from '@/hooks/queries/bilibili/recommendation'
import { useNowPlayingBar } from '@/hooks/ui/useNowPlayingBar'
import { mapBilibiliVideoDetailsToTrack } from '@/utils/bilibili-track'

export default function RecommendationsPage() {
	useNowPlayingBar()
	const router = useRouter()
	const { colors } = useTheme()
	const [refreshing, setRefreshing] = useState(false)
	const {
		data,
		isPending,
		isError,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useBilibiliMusicRecommendations()
	const { selected, selectMode, toggle, enterSelectMode } = useTrackSelection()
	const selection = useMemo(
		() => ({
			active: selectMode,
			selected,
			toggle,
			enter: enterSelectMode,
		}),
		[enterSelectMode, selectMode, selected, toggle],
	)
	const { playTrack } = useRemotePlaylist()
	const trackMenuItems = usePlaylistMenu(playTrack)

	const tracks = useMemo(() => {
		const recommendations = data?.pages.flat() ?? []
		const unique = new Map(
			recommendations.map((item) => [item.detail.bvid, item.detail]),
		)
		return Array.from(unique.values()).map(mapBilibiliVideoDetailsToTrack)
	}, [data])

	const refresh = async () => {
		setRefreshing(true)
		try {
			await refetch()
		} finally {
			setRefreshing(false)
		}
	}

	if (isPending) return <PlaylistPageSkeleton />
	if (isError) return <PlaylistError text='个性化推荐加载失败' />

	return (
		<View style={[styles.container, { backgroundColor: colors.background }]}>
			<Appbar.Header elevated>
				<Appbar.BackAction onPress={() => router.back()} />
				<Appbar.Content title='为你推荐' />
			</Appbar.Header>
			<Text
				variant='bodyMedium'
				style={[styles.description, { color: colors.onSurfaceVariant }]}
			>
				根据 B 站推荐流筛选音乐、MV 与 VOCALOID·UTAU 内容
			</Text>
			<TrackList
				tracks={tracks}
				playTrack={playTrack}
				trackMenuItems={trackMenuItems}
				selection={selection}
				hasNextPage={hasNextPage}
				isFetchingNextPage={isFetchingNextPage}
				onEndReached={() => {
					if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
				}}
				onEndReachedThreshold={0.5}
				ListHeaderComponent={<ThemedRefreshIndicator refreshing={refreshing} />}
				refreshControl={
					<ThemedRefreshControl
						refreshing={refreshing}
						onRefresh={refresh}
					/>
				}
			/>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	description: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
})
