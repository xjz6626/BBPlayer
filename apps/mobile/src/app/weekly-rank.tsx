import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Linking, SectionList, StyleSheet, View } from 'react-native'
import { Appbar, Button, List, Text, useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import NowPlayingBar from '@/components/NowPlayingBar'
import ThemedRefreshControl, {
	ThemedRefreshIndicator,
} from '@/components/theme/ThemedRefreshControl'
import { useRemotePlaylist } from '@/features/playlist/remote/hooks/useRemotePlaylist'
import {
	useWeeklyVocalRank,
	weeklyVocalRankQueryKey,
} from '@/hooks/queries/bilibili/weekly'
import { queryClient } from '@/lib/config/queryClient'
import { syncFacade } from '@/lib/facades/syncBilibiliPlaylist'
import {
	clearWeeklyVocalRankCache,
	type WeeklyRankEntry,
} from '@/lib/services/weeklyVocalRank'
import { mapBilibiliVideoDetailsToTrack } from '@/utils/bilibili-track'
import { toastAndLogError } from '@/utils/error-handling'
import { addToQueue } from '@/utils/player'
import toast from '@/utils/toast'

export default function WeeklyRankPage() {
	const router = useRouter()
	const { colors } = useTheme()
	const [refreshing, setRefreshing] = useState(false)
	const { data, isPending, isError, error } = useWeeklyVocalRank()
	const { playTrack } = useRemotePlaylist()

	const tracks = useMemo(
		() =>
			(data?.sections ?? [])
				.flatMap((section) => section.entries)
				.flatMap((entry) =>
					entry.detail ? [mapBilibiliVideoDetailsToTrack(entry.detail)] : [],
				),
		[data],
	)
	const listSections = useMemo(
		() =>
			(data?.sections ?? []).map((section) => ({
				title: section.title,
				data: section.entries,
			})),
		[data],
	)

	const refresh = useCallback(async () => {
		setRefreshing(true)
		clearWeeklyVocalRankCache()
		try {
			await queryClient.refetchQueries({ queryKey: weeklyVocalRankQueryKey })
		} finally {
			setRefreshing(false)
		}
	}, [])

	const playEntry = useCallback(
		(entry: WeeklyRankEntry) => {
			if (!entry.detail) {
				toast.error('这首歌的详情暂时加载失败')
				return
			}
			void playTrack(mapBilibiliVideoDetailsToTrack(entry.detail))
		},
		[playTrack],
	)

	const playAll = useCallback(async () => {
		if (tracks.length === 0) {
			toast.error('没有可播放的歌曲')
			return
		}
		const persistResult = await syncFacade.addTracksToLocal(tracks)
		if (persistResult.isErr()) {
			toastAndLogError(
				'播放全部失败，歌曲入库时发生错误',
				persistResult.error,
				'WeeklyRank.PlayAll',
			)
			return
		}
		await addToQueue({
			tracks: persistResult.value,
			playNow: true,
			clearQueue: true,
			playNext: false,
		})
	}, [tracks])

	return (
		<View style={[styles.container, { backgroundColor: colors.background }]}>
			<Appbar.Header elevated>
				<Appbar.BackAction onPress={() => router.back()} />
				<Appbar.Content title='周刊虚拟歌手中文曲排行榜' />
				<Appbar.Action
					icon='open-in-new'
					disabled={!data?.video.bvid}
					onPress={() => {
						if (data?.video.bvid) {
							void Linking.openURL(
								`https://www.bilibili.com/video/${data.video.bvid}`,
							)
						}
					}}
				/>
			</Appbar.Header>
			{isPending ? (
				<View style={styles.center}>
					<ActivityIndicator size='large' />
				</View>
			) : isError ? (
				<View style={styles.center}>
					<Text variant='titleMedium'>榜单加载失败</Text>
					<Text style={{ color: colors.onSurfaceVariant }}>
						{error instanceof Error ? error.message : '请稍后重试'}
					</Text>
					<Button onPress={refresh}>重试</Button>
				</View>
			) : (
				<SectionList
					sections={listSections}
					keyExtractor={(item) => item.id}
					refreshControl={
						<ThemedRefreshControl
							refreshing={refreshing}
							onRefresh={refresh}
						/>
					}
					ListHeaderComponent={
						<>
							<ThemedRefreshIndicator refreshing={refreshing} />
							<View style={styles.header}>
								{data?.video.cover ? (
									<Image
										source={data.video.cover}
										style={styles.cover}
										contentFit='cover'
									/>
								) : null}
								<View style={styles.headerText}>
									<Text
										variant='titleMedium'
										numberOfLines={3}
									>
										{data?.video.title}
									</Text>
									<Text style={{ color: colors.onSurfaceVariant }}>
										{data?.total ?? 0} 首 · 排名评论来自{' '}
										{data?.commentAuthor ?? '周刊作者'}
									</Text>
									<Button
										mode='contained'
										icon='play'
										onPress={playAll}
										style={styles.playAllButton}
									>
										播放全部
									</Button>
								</View>
							</View>
						</>
					}
					renderSectionHeader={({ section }) => (
						<View
							style={[
								styles.sectionHeader,
								{ backgroundColor: colors.background },
							]}
						>
							<Text variant='titleMedium'>{section.title}</Text>
						</View>
					)}
					renderItem={({ item }) => (
						<List.Item
							title={item.title}
							description={item.detail?.owner.name ?? item.bvid}
							left={() => (
								<View style={styles.rankContainer}>
									<Text variant='titleMedium'>{item.label}</Text>
								</View>
							)}
							right={() =>
								item.detail?.pic ? (
									<Image
										source={item.detail.pic}
										style={styles.itemCover}
										contentFit='cover'
									/>
								) : null
							}
							onPress={() => playEntry(item)}
						/>
					)}
					contentContainerStyle={styles.listContent}
				/>
			)}
			<NowPlayingBar />
		</View>
	)
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	center: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 12,
		padding: 24,
	},
	header: {
		flexDirection: 'row',
		padding: 16,
		gap: 16,
	},
	cover: {
		width: 120,
		height: 120,
		borderRadius: 12,
	},
	headerText: {
		flex: 1,
		justifyContent: 'center',
		gap: 8,
	},
	playAllButton: { alignSelf: 'flex-start' },
	sectionHeader: {
		paddingHorizontal: 16,
		paddingVertical: 10,
	},
	rankContainer: {
		width: 48,
		alignItems: 'center',
		justifyContent: 'center',
	},
	itemCover: {
		width: 80,
		height: 45,
		borderRadius: 6,
		marginRight: 12,
	},
	listContent: { paddingBottom: 96 },
})
