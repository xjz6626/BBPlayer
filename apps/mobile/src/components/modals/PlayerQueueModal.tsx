import type { Track as OrpheusTrack } from '@bbplayer/orpheus'
import { Orpheus } from '@bbplayer/orpheus'
import type { LegendListRef } from '@legendapp/list/react-native'
import { LegendList } from '@legendapp/list/react-native'
import {
	TrueSheet,
	type TrueSheetProps,
} from '@lodev09/react-native-true-sheet'
import {
	memo,
	useCallback,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView, Touchable } from 'react-native-gesture-handler'
import { Surface, Text, useTheme } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Button from '@/components/common/Button'
import IconButton from '@/components/common/IconButton'
import { useBatchAddToDefaultFavorite } from '@/hooks/mutations/bilibili/favorite'
import useCurrentTrackId from '@/hooks/player/useCurrentTrackId'
import { useIsCurrentTrack } from '@/hooks/player/useIsCurrentTrack'
import { usePersonalInformation } from '@/hooks/queries/bilibili/user'
import useAppStore from '@/hooks/stores/useAppStore'
import { useModalStore } from '@/hooks/stores/useModalStore'
import { usePlayerQueueSheetStore } from '@/hooks/stores/usePlayerQueueSheetStore'
import { usePlayerQueueStore } from '@/hooks/stores/usePlayerQueueStore'
import { toastAndLogError } from '@/utils/error-handling'
import toast from '@/utils/toast'

const TrackItem = memo(
	({
		track,
		onSwitchTrack,
		onRemoveTrack,
		index,
	}: {
		track: OrpheusTrack
		onSwitchTrack: (index: number) => void
		onRemoveTrack: (index: number) => void
		index: number
	}) => {
		const colors = useTheme().colors
		const isCurrentTrack = useIsCurrentTrack(track.id)
		return (
			<Surface
				style={{
					backgroundColor: isCurrentTrack ? colors.elevation.level5 : undefined,
					overflow: 'hidden',
					borderRadius: 8,
					minHeight: 56, // Enforce min height for visual consistency
				}}
				elevation={0}
			>
				<Touchable
					androidRipple={{}}
					onPress={() => onSwitchTrack(index)}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: 8,
							flex: 1,
						}}
					>
						<View
							style={{
								paddingRight: 0,
								flex: 1,
								marginLeft: 12,
								flexDirection: 'column',
							}}
						>
							<Text
								variant='bodyMedium'
								numberOfLines={1}
								style={{ fontWeight: 'bold' }}
							>
								{track.title}
							</Text>
							<Text
								variant='bodySmall'
								style={{ fontWeight: 'thin' }}
								numberOfLines={1}
							>
								{track.artist ?? '未知作者'}
							</Text>
						</View>
						<IconButton
							icon='close-circle-outline'
							size={24}
							onPress={() => {
								onRemoveTrack(index)
							}}
						/>
					</View>
				</Touchable>
			</Surface>
		)
	},
)

TrackItem.displayName = 'TrackItem'

interface PlayerQueueModalProps extends TrueSheetProps {
	sheetRef?: RefObject<TrueSheet | null>
}

function PlayerQueueModal({ sheetRef, ...props }: PlayerQueueModalProps) {
	const currentTrackId = useCurrentTrackId()
	const theme = useTheme()
	const [didInitialScroll, setDidInitialScroll] = useState(false)
	const [isClearing, setIsClearing] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	const flatListRef = useRef<LegendListRef>(null)

	const queue = usePlayerQueueStore((state) => state.tracks)
	const hasBilibiliCookie = useAppStore((state) => state.hasBilibiliCookie())
	const { data: personalInformation } = usePersonalInformation()
	const { mutate: batchAddToDefaultFavorite, isPending: isFavoriting } =
		useBatchAddToDefaultFavorite()
	const queueBvids = useMemo(
		() =>
			Array.from(
				new Set(
					queue.flatMap((track) => {
						const [source, bvid] = track.id.split('::')
						return source === 'bilibili' && bvid ? [bvid] : []
					}),
				),
			),
		[queue],
	)

	const currentIndex = useMemo(() => {
		if (!currentTrackId) return -1
		return queue.findIndex((t) => t.id === currentTrackId)
	}, [currentTrackId, queue])

	const insets = useSafeAreaInsets()

	const switchTrackHandler = useCallback(
		async (index: number) => {
			if (index === -1) return
			const target = queue[index]
			if (!target) return
			if (target.id === currentTrackId) return
			await Orpheus.skipTo(index)
		},
		[queue, currentTrackId],
	)

	const removeTrackHandler = useCallback(async (index: number) => {
		await Orpheus.removeTrack(index)
	}, [])

	const clearQueueHandler = useCallback(async () => {
		if (queue.length === 0 || isClearing) return

		setIsClearing(true)
		try {
			await Orpheus.clear()
		} catch (error) {
			toastAndLogError('清空播放队列失败', error, 'UI.Modal.PlayerQueue')
		} finally {
			setIsClearing(false)
		}
	}, [isClearing, queue.length])

	const favoriteQueueHandler = useCallback(() => {
		if (queueBvids.length === 0) {
			toast.info('队列中没有可收藏的 Bilibili 视频')
			return
		}
		if (!hasBilibiliCookie || !personalInformation?.mid) {
			toast.info('请先登录 B 站账号')
			return
		}

		batchAddToDefaultFavorite({
			bvids: queueBvids,
			userMid: personalInformation.mid,
		})
	}, [
		batchAddToDefaultFavorite,
		hasBilibiliCookie,
		personalInformation?.mid,
		queueBvids,
	])

	const saveQueueHandler = useCallback(async () => {
		if (queue.length === 0 || isSaving) return

		setIsSaving(true)
		const tracks = [...queue]
		try {
			// Wait for the sheet's dismissal animation before presenting the naming dialog.
			await TrueSheet.dismiss('playerQueueModal')
			useModalStore.getState().open('SaveQueueToPlaylist', { tracks })
		} catch (error) {
			toastAndLogError(
				'打开保存播放队列窗口失败',
				error,
				'UI.Modal.PlayerQueue',
			)
		} finally {
			setIsSaving(false)
		}
	}, [isSaving, queue])

	const keyExtractor = useCallback((item: OrpheusTrack) => item.id, [])

	const renderItem = useCallback(
		({ item, index }: { item: OrpheusTrack; index: number }) => (
			<TrackItem
				track={item}
				onSwitchTrack={switchTrackHandler}
				onRemoveTrack={removeTrackHandler}
				index={index}
			/>
		),
		[switchTrackHandler, removeTrackHandler],
	)

	const scrollToCurrent = useCallback(() => {
		if (currentIndex === -1 || !queue.length || didInitialScroll) return
		void flatListRef.current?.scrollToIndex({
			animated: false,
			index: currentIndex,
			viewPosition: 0.5,
		})
		setDidInitialScroll(true)
	}, [currentIndex, queue.length, didInitialScroll])

	return (
		<TrueSheet
			name='playerQueueModal'
			ref={sheetRef}
			detents={[0.75]}
			cornerRadius={24}
			backgroundColor={theme.colors.elevation.level1}
			scrollable
			onMount={scrollToCurrent}
			onDidPresent={() => {
				usePlayerQueueSheetStore.getState().setOpen(true)
			}}
			onDidDismiss={() => {
				usePlayerQueueSheetStore.getState().setOpen(false)
				setDidInitialScroll(false)
			}}
			{...props}
		>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<View
					style={{
						height: '100%',
					}}
				>
					<View
						style={{
							flexDirection: 'row',
							justifyContent: 'space-between',
							alignItems: 'center',
							paddingHorizontal: 16,
							paddingTop: 8,
							borderBottomWidth: 1,
							borderBottomColor: theme.colors.elevation.level2,
						}}
					>
						<Text variant='titleMedium'>播放队列 ({queue.length})</Text>
						<View
							style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
						>
							<Button
								compact
								icon='trash-can-outline'
								textColor={theme.colors.error}
								onPress={() => void clearQueueHandler()}
								disabled={
									queue.length === 0 || isClearing || isFavoriting || isSaving
								}
								loading={isClearing}
								testID='player-queue-clear'
							>
								清空
							</Button>
							<Button
								compact
								icon='star-outline'
								onPress={favoriteQueueHandler}
								disabled={
									queue.length === 0 || isClearing || isFavoriting || isSaving
								}
								loading={isFavoriting}
								testID='player-queue-favorite'
							>
								收藏
							</Button>
							<IconButton
								icon='content-save-outline'
								onPress={() => void saveQueueHandler()}
								disabled={
									queue.length === 0 || isClearing || isFavoriting || isSaving
								}
								loading={isSaving}
								testID='player-queue-save'
							/>
						</View>
					</View>
					<View style={{ flex: 1, minHeight: 2 }}>
						<LegendList
							ref={flatListRef}
							data={queue}
							renderItem={renderItem}
							keyExtractor={keyExtractor}
							recycleItems
							contentContainerStyle={{
								paddingBottom: insets.bottom + 20,
							}}
							showsVerticalScrollIndicator={false}
							nestedScrollEnabled
						/>
					</View>
				</View>
			</GestureHandlerRootView>
		</TrueSheet>
	)
}

export default PlayerQueueModal
