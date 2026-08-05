import { LegendList } from '@legendapp/list/react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Text, useTheme } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import IconButton from '@/components/common/IconButton'
import SkinAppbarBackground from '@/components/navigation/SkinAppbarBackground'
import NowPlayingBar from '@/components/NowPlayingBar'
import ThemedRefreshControl, {
	ThemedRefreshIndicator,
} from '@/components/theme/ThemedRefreshControl'
import DynamicFeedItem from '@/features/dynamic/DynamicFeedItem'
import FollowingSelector from '@/features/dynamic/FollowingSelector'
import { usePlaylistMenu } from '@/features/playlist/remote/hooks/usePlaylistMenu'
import { useRemotePlaylist } from '@/features/playlist/remote/hooks/useRemotePlaylist'
import {
	dismissBilibiliDynamicFeedUpdate,
	useBilibiliDynamicFeed,
	useBilibiliFollowings,
} from '@/hooks/queries/bilibili/dynamic'
import { usePersonalInformation } from '@/hooks/queries/bilibili/user'
import useAppStore from '@/hooks/stores/useAppStore'
import useActiveSkin from '@/hooks/theme/useActiveSkin'

export default function DynamicFeedPage() {
	const router = useRouter()
	const insets = useSafeAreaInsets()
	const { colors } = useTheme()
	const activeSkin = useActiveSkin()
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())
	const [selectedMid, setSelectedMid] = useState<number>()
	const [refreshing, setRefreshing] = useState(false)
	const { data: personalInformation } = usePersonalInformation()
	const {
		data: followingData,
		fetchNextPage: fetchNextFollowingPage,
		hasNextPage: hasNextFollowingPage,
		isFetchingNextPage: isFetchingNextFollowingPage,
		refetch: refetchFollowings,
	} = useBilibiliFollowings(personalInformation?.mid)
	const {
		data: dynamicData,
		isPending,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useBilibiliDynamicFeed(selectedMid)
	const { playTrack } = useRemotePlaylist()
	const trackMenuItems = usePlaylistMenu(playTrack)

	useFocusEffect(
		useCallback(() => {
			dismissBilibiliDynamicFeedUpdate()
		}, []),
	)

	const followingUsers = useMemo(() => {
		const users = followingData?.pages.flatMap((page) => page.list ?? []) ?? []
		return Array.from(new Map(users.map((user) => [user.mid, user])).values())
	}, [followingData])

	const dynamicItems = useMemo(() => {
		const items = dynamicData?.pages.flatMap((page) => page.items) ?? []
		return Array.from(
			new Map(
				items.filter((item) => item.visible).map((item) => [item.id_str, item]),
			).values(),
		)
	}, [dynamicData])

	const refresh = useCallback(async () => {
		setRefreshing(true)
		try {
			await Promise.all([refetch(), refetchFollowings()])
		} finally {
			setRefreshing(false)
		}
	}, [refetch, refetchFollowings])

	return (
		<View style={[styles.container, { backgroundColor: colors.background }]}>
			<SkinAppbarBackground height={insets.top + 100} />
			<View style={[styles.content, { paddingTop: insets.top + 8 }]}>
				<View style={styles.header}>
					<Text
						variant='headlineSmall'
						style={styles.title}
					>
						关注动态
					</Text>
					{hasCookie ? (
						refreshing ? (
							<ActivityIndicator
								size='small'
								style={styles.headerLoading}
							/>
						) : (
							<IconButton
								icon='refresh'
								onPress={() => void refresh()}
							/>
						)
					) : null}
				</View>

				{!hasCookie ? (
					<View style={styles.center}>
						<Text variant='titleMedium'>登录 B 站账号后才能查看关注动态</Text>
						<Button
							mode='contained'
							onPress={() =>
								router.push('/settings/bilibili-account/qrcode-login' as never)
							}
						>
							去登录
						</Button>
					</View>
				) : (
					<>
						<FollowingSelector
							users={followingUsers}
							selectedMid={selectedMid}
							isFetchingNextPage={isFetchingNextFollowingPage}
							hasNextPage={hasNextFollowingPage}
							onSelect={setSelectedMid}
							onEndReached={() => void fetchNextFollowingPage()}
						/>

						{isPending ? (
							<View style={styles.center}>
								<ActivityIndicator size='large' />
							</View>
						) : isError ? (
							<View style={styles.center}>
								<Text variant='titleMedium'>动态加载失败</Text>
								<Text
									style={[styles.errorText, { color: colors.onSurfaceVariant }]}
								>
									{error instanceof Error ? error.message : '请稍后重试'}
								</Text>
								<Button onPress={() => void refetch()}>重试</Button>
							</View>
						) : (
							<LegendList
								data={dynamicItems}
								recycleItems
								keyExtractor={(item) => item.id_str}
								renderItem={({ item }) => (
									<DynamicFeedItem
										item={item}
										playTrack={playTrack}
										skin={activeSkin}
										trackMenuItems={trackMenuItems}
									/>
								)}
								onEndReached={() => {
									if (hasNextPage && !isFetchingNextPage) {
										void fetchNextPage()
									}
								}}
								onEndReachedThreshold={0.4}
								refreshControl={
									<ThemedRefreshControl
										refreshing={refreshing}
										onRefresh={refresh}
									/>
								}
								contentContainerStyle={styles.listContent}
								ListHeaderComponent={
									<ThemedRefreshIndicator refreshing={refreshing} />
								}
								ListFooterComponent={
									isFetchingNextPage ? (
										<View style={styles.footer}>
											<ActivityIndicator size='small' />
										</View>
									) : null
								}
								ListEmptyComponent={
									<View style={styles.empty}>
										<Text style={{ color: colors.onSurfaceVariant }}>
											暂无视频动态
										</Text>
									</View>
								}
							/>
						)}
					</>
				)}
			</View>
			<View style={styles.nowPlayingBarContainer}>
				<NowPlayingBar />
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	content: {
		flex: 1,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingBottom: 8,
	},
	headerLoading: {
		margin: 12,
	},
	title: {
		fontWeight: 'bold',
	},
	center: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 12,
		padding: 24,
	},
	errorText: {
		textAlign: 'center',
	},
	listContent: {
		paddingTop: 6,
		paddingBottom: 96,
	},
	footer: {
		alignItems: 'center',
		padding: 20,
	},
	empty: {
		alignItems: 'center',
		padding: 48,
	},
	nowPlayingBarContainer: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
	},
})
