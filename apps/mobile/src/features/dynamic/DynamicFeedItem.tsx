import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { memo, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
	Avatar,
	Button,
	Card,
	IconButton,
	Text,
	TouchableRipple,
	useTheme,
} from 'react-native-paper'

import FunctionalMenu from '@/components/common/FunctionalMenu'
import SkinThumbUpBurst from '@/components/theme/SkinThumbUpBurst'
import type { TrackMenuItem } from '@/features/playlist/remote/components/PlaylistItem'
import { useModifyDynamicThumb } from '@/hooks/mutations/bilibili/dynamic'
import type { AppSkin } from '@/lib/theme/types'
import type { BilibiliDynamicItem } from '@/types/apis/bilibili'
import type { BilibiliTrack } from '@/types/core/media'
import {
	getBilibiliDynamicArchiveSource,
	mapBilibiliDynamicItemToTrack,
} from '@/utils/bilibili-dynamic'
import { resolveBilibiliImageUrl } from '@/utils/imageUrl'
import { formatRelativeTime } from '@/utils/time'

interface DynamicFeedItemProps {
	item: BilibiliDynamicItem
	playTrack: (track: BilibiliTrack, playNext?: boolean) => void
	skin: AppSkin | null
	trackMenuItems: (track: BilibiliTrack) => TrackMenuItem[]
}

const formatCount = (value: number) => {
	if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
	if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
	return value > 0 ? String(value) : ''
}

export default memo(function DynamicFeedItem({
	item,
	playTrack,
	skin,
	trackMenuItems,
}: DynamicFeedItemProps) {
	const router = useRouter()
	const { colors } = useTheme()
	const author = item.modules.module_author
	const stat = item.modules.module_stat
	const archiveSource = getBilibiliDynamicArchiveSource(item)
	const archive = archiveSource?.archive
	const track = useMemo(() => mapBilibiliDynamicItemToTrack(item), [item])
	const [isLiked, setIsLiked] = useState(stat?.like.status === true)
	const [likeCount, setLikeCount] = useState(stat?.like.count ?? 0)
	const [thumbUpBurstSignal, setThumbUpBurstSignal] = useState(0)
	const { mutate: modifyThumb, isPending: isThumbPending } =
		useModifyDynamicThumb()

	useEffect(() => {
		setIsLiked(stat?.like.status === true)
		setLikeCount(stat?.like.count ?? 0)
	}, [item.id_str, stat?.like.count, stat?.like.status])

	const textContent =
		item.modules.module_dynamic.desc?.text ??
		item.modules.module_dynamic.major?.opus?.summary.text ??
		''
	const timeDisplay =
		author.pub_time || formatRelativeTime(author.pub_ts * 1000)

	const handleThumb = () => {
		if (!stat || isThumbPending || stat.like.forbidden) return
		const previousLiked = isLiked
		const previousCount = likeCount
		const nextLiked = !previousLiked
		setIsLiked(nextLiked)
		setLikeCount(Math.max(0, previousCount + (nextLiked ? 1 : -1)))
		modifyThumb(
			{ dynamicId: item.id_str, like: nextLiked },
			{
				onSuccess: () => {
					if (nextLiked) setThumbUpBurstSignal((signal) => signal + 1)
				},
				onError: () => {
					setIsLiked(previousLiked)
					setLikeCount(previousCount)
				},
			},
		)
	}

	return (
		<Card
			mode='contained'
			style={[styles.card, { backgroundColor: colors.surfaceVariant }]}
		>
			<Card.Content style={styles.content}>
				<View style={styles.header}>
					<TouchableRipple
						onPress={() =>
							router.push({
								pathname: '/playlist/remote/uploader/[mid]',
								params: { mid: author.mid.toString() },
							})
						}
						borderless
						style={styles.authorButton}
					>
						<View style={styles.authorContent}>
							<Avatar.Image
								size={42}
								source={{
									uri: resolveBilibiliImageUrl(author.face, 160) ?? '',
								}}
							/>
							<View style={styles.authorText}>
								<Text
									variant='titleSmall'
									numberOfLines={1}
								>
									{author.name}
								</Text>
								<Text
									variant='bodySmall'
									numberOfLines={1}
									style={{ color: colors.onSurfaceVariant }}
								>
									{timeDisplay}
									{author.pub_action ? ` · ${author.pub_action}` : ''}
								</Text>
							</View>
						</View>
					</TouchableRipple>
					{track ? (
						<FunctionalMenu
							anchor={
								<IconButton
									icon='dots-vertical'
									size={20}
								/>
							}
						>
							{trackMenuItems(track).map((menuItem) => (
								<FunctionalMenu.Item
									key={menuItem.title}
									title={menuItem.title}
									leadingIcon={menuItem.leadingIcon}
									onPress={menuItem.onPress}
								/>
							))}
						</FunctionalMenu>
					) : null}
				</View>

				{textContent ? (
					<Text
						variant='bodyMedium'
						style={styles.dynamicText}
					>
						{textContent}
					</Text>
				) : null}

				{archive && track ? (
					<TouchableRipple
						onPress={() => playTrack(track)}
						style={[styles.archiveCard, { backgroundColor: colors.surface }]}
						testID={`dynamic-video-${archive.bvid}`}
					>
						<View style={styles.archiveContent}>
							<View style={styles.coverContainer}>
								<Image
									source={resolveBilibiliImageUrl(track.coverUrl, 480)}
									style={styles.cover}
									contentFit='cover'
								/>
								{archive.duration_text ? (
									<View style={styles.durationBadge}>
										<Text
											variant='labelSmall'
											style={styles.durationText}
										>
											{archive.duration_text}
										</Text>
									</View>
								) : null}
							</View>
							<View style={styles.archiveText}>
								<Text
									variant='titleSmall'
									numberOfLines={2}
								>
									{archive.title}
								</Text>
								<Text
									variant='bodySmall'
									numberOfLines={2}
									style={{ color: colors.onSurfaceVariant }}
								>
									{archive.desc}
								</Text>
								<Text
									variant='labelSmall'
									style={{ color: colors.onSurfaceVariant }}
								>
									{archive.stat.play ? `${archive.stat.play} 播放` : ''}
								</Text>
							</View>
						</View>
					</TouchableRipple>
				) : null}
			</Card.Content>

			<Card.Actions style={styles.actions}>
				<View style={styles.likeAction}>
					<SkinThumbUpBurst
						playSignal={thumbUpBurstSignal}
						size={80}
						skin={skin}
						style={styles.likeBurst}
					/>
					<Button
						compact
						icon={isLiked ? 'thumb-up' : 'thumb-up-outline'}
						disabled={!stat || isThumbPending || stat.like.forbidden}
						onPress={handleThumb}
					>
						{formatCount(likeCount) || '点赞'}
					</Button>
				</View>
				<Button
					compact
					icon='comment-outline'
					disabled={!archive || stat?.comment.forbidden}
					onPress={() => {
						if (archive) router.push(`/comments/${archive.bvid}`)
					}}
				>
					{formatCount(stat?.comment.count ?? 0) || '评论'}
				</Button>
				<View style={styles.actionSpacer} />
				<Button
					compact
					icon='play'
					disabled={!track}
					onPress={() => {
						if (track) playTrack(track)
					}}
				>
					播放
				</Button>
			</Card.Actions>
		</Card>
	)
})

const styles = StyleSheet.create({
	card: {
		marginHorizontal: 12,
		marginVertical: 6,
		borderRadius: 16,
		overflow: 'hidden',
	},
	content: {
		paddingTop: 14,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	authorButton: {
		flex: 1,
		borderRadius: 12,
	},
	authorContent: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingVertical: 2,
	},
	authorText: {
		flex: 1,
	},
	dynamicText: {
		marginTop: 12,
		lineHeight: 21,
	},
	archiveCard: {
		marginTop: 12,
		borderRadius: 12,
		overflow: 'hidden',
	},
	archiveContent: {
		flexDirection: 'row',
	},
	coverContainer: {
		width: 144,
		aspectRatio: 16 / 9,
	},
	cover: {
		width: '100%',
		height: '100%',
	},
	durationBadge: {
		position: 'absolute',
		right: 4,
		bottom: 4,
		paddingHorizontal: 5,
		paddingVertical: 1,
		borderRadius: 4,
		backgroundColor: 'rgba(0, 0, 0, 0.72)',
	},
	durationText: {
		color: 'white',
	},
	archiveText: {
		flex: 1,
		justifyContent: 'space-between',
		gap: 3,
		padding: 10,
	},
	actions: {
		paddingHorizontal: 8,
		paddingBottom: 8,
	},
	likeAction: {
		position: 'relative',
	},
	likeBurst: {
		bottom: 26,
		right: -18,
	},
	actionSpacer: {
		flex: 1,
	},
})
