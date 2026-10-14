import { useSpectrumVisualizerEnabled } from '@bbplayer/orpheus'
import { useIsPlaying } from '@bbplayer/orpheus'
import type { ImageRef } from 'expo-image'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import {
	Dimensions,
	Pressable,
	StyleSheet,
	TouchableOpacity,
	View,
} from 'react-native'
import SquircleView from 'react-native-fast-squircle'
import { Button, Text, TouchableRipple, useTheme } from 'react-native-paper'

import IconButton from '@/components/common/IconButton'
import SkinThumbUpBurst from '@/components/theme/SkinThumbUpBurst'
import { SpectrumVisualizer } from '@/features/player/components/visuals/SpectrumVisualizer'
import { useToggleDefaultFavorite } from '@/hooks/mutations/bilibili/favorite'
import { useModifyUserRelation } from '@/hooks/mutations/bilibili/user'
import useCurrentTrack from '@/hooks/player/useCurrentTrack'
import { useGetFavoriteForOneVideo } from '@/hooks/queries/bilibili/favorite'
import {
	usePersonalInformation,
	useUserRelation,
} from '@/hooks/queries/bilibili/user'
import useActiveSkin from '@/hooks/theme/useActiveSkin'
import useResolvedColorScheme from '@/hooks/theme/useResolvedColorScheme'
import { getGradientColors } from '@/utils/color'
import toast from '@/utils/toast'

const { width: screenWidth } = Dimensions.get('window')

const COVER_SIZE_RECT = screenWidth - 80
const COVER_SIZE_CIRCLE = screenWidth - 120

export function TrackInfo({
	onArtistPress,
	onPressCover,
	coverRef,
}: {
	onArtistPress: () => void
	onPressCover: () => void
	coverRef: ImageRef | null
}) {
	const { colors } = useTheme()
	const colorScheme = useResolvedColorScheme()
	const isDark: boolean = colorScheme === 'dark'

	const currentTrack = useCurrentTrack()
	const isPlaying = useIsPlaying()
	const [isTitleExpanded, setIsTitleExpanded] = useState(false)
	const [favoriteBurstSignal, setFavoriteBurstSignal] = useState(0)
	const activeSkin = useActiveSkin()

	const enableSpectrumVisualizer = useSpectrumVisualizerEnabled()

	const isBilibiliVideo = currentTrack?.source === 'bilibili'
	const bvid = isBilibiliVideo ? currentTrack.bilibiliMetadata.bvid : ''
	const uploaderMid =
		isBilibiliVideo && currentTrack.artist?.remoteId
			? Number(currentTrack.artist.remoteId)
			: undefined
	const { data: personalInformation } = usePersonalInformation()
	const { data: favoriteFolders, isFetching: isFavoriteStatusFetching } =
		useGetFavoriteForOneVideo(bvid, personalInformation?.mid)
	const defaultFavoriteFolder =
		favoriteFolders?.find((folder) => ((folder.attr ?? 0) >> 1) % 2 === 0) ??
		favoriteFolders?.[0]
	const isInDefaultFavorite = defaultFavoriteFolder?.fav_state === 1
	const {
		mutate: toggleDefaultFavorite,
		isPending: isFavoriteMutationPending,
	} = useToggleDefaultFavorite()
	const { data: relation, isPending: isRelationPending } =
		useUserRelation(uploaderMid)
	const { mutate: modifyRelation, isPending: isRelationMutationPending } =
		useModifyUserRelation()
	const isFollowed = relation?.attribute === 2 || relation?.attribute === 6
	const canFollow =
		!!uploaderMid && personalInformation?.mid !== uploaderMid && !!relation

	const { color1, color2 } = getGradientColors(
		currentTrack?.title ?? '',
		isDark,
	)

	const firstChar =
		currentTrack &&
		(currentTrack.title.length > 0
			? currentTrack?.title.charAt(0).toUpperCase()
			: undefined)

	const coverSize = enableSpectrumVisualizer
		? COVER_SIZE_CIRCLE
		: COVER_SIZE_RECT
	const coverBorderRadius = enableSpectrumVisualizer
		? coverSize / 2
		: COVER_SIZE_RECT * 0.22

	const onFavoritePress = () => {
		if (!bvid || isFavoriteStatusFetching || isFavoriteMutationPending) {
			return
		}
		if (!personalInformation?.mid) {
			toast.error('请先登录 bilibili 账号')
			return
		}
		if (!defaultFavoriteFolder) {
			toast.error('还没有可用的收藏夹')
			return
		}
		toggleDefaultFavorite(
			{
				bvid,
				folderId: defaultFavoriteFolder.id,
				favorite: !isInDefaultFavorite,
			},
			{
				onSuccess: () => {
					if (!isInDefaultFavorite) {
						setFavoriteBurstSignal((signal) => signal + 1)
					}
				},
			},
		)
	}

	const onFollowPress = () => {
		if (!uploaderMid || !canFollow || isRelationMutationPending) return
		modifyRelation({ mid: uploaderMid, follow: !isFollowed })
	}

	useEffect(() => {
		setIsTitleExpanded(false)
	}, [currentTrack?.uniqueKey])

	if (!currentTrack) return null

	return (
		<View
			style={{
				position: 'relative',
			}}
		>
			<Pressable
				style={styles.coverContainer}
				onPress={onPressCover}
			>
				{enableSpectrumVisualizer && (
					<View
						style={[
							StyleSheet.absoluteFill,
							{ alignItems: 'center', justifyContent: 'center' },
						]}
					>
						<SpectrumVisualizer
							isPlaying={isPlaying}
							size={coverSize}
							color={colors.primary}
						/>
					</View>
				)}
				<TouchableOpacity
					activeOpacity={0.8}
					onPress={onPressCover}
					style={{ width: coverSize, height: coverSize }}
					testID='player-cover'
				>
					{!coverRef ? (
						enableSpectrumVisualizer ? (
							<LinearGradient
								colors={[color1, color2]}
								style={[
									styles.coverGradient,
									{ borderRadius: coverBorderRadius },
								]}
								start={{ x: 0, y: 0 }}
								end={{ x: 1, y: 1 }}
							>
								<Text
									style={[
										styles.coverPlaceholderText,
										{ fontSize: coverSize * 0.45 },
									]}
								>
									{firstChar}
								</Text>
							</LinearGradient>
						) : (
							<SquircleView
								style={[
									styles.coverGradient,
									{ borderRadius: coverBorderRadius, overflow: 'hidden' },
								]}
								cornerSmoothing={0.6}
							>
								<LinearGradient
									colors={[color1, color2]}
									style={StyleSheet.absoluteFill}
									start={{ x: 0, y: 0 }}
									end={{ x: 1, y: 1 }}
								/>
								<Text
									style={[
										styles.coverPlaceholderText,
										{ fontSize: coverSize * 0.45 },
									]}
								>
									{firstChar}
								</Text>
							</SquircleView>
						)
					) : enableSpectrumVisualizer ? (
						<Image
							source={coverRef}
							style={{
								width: coverSize,
								height: coverSize,
								borderRadius: coverBorderRadius,
								zIndex: -1,
							}}
							recyclingKey={currentTrack.uniqueKey}
							cachePolicy={'disk'}
							transition={300}
						/>
					) : (
						<SquircleView
							style={{
								width: coverSize,
								height: coverSize,
								borderRadius: coverBorderRadius,
								overflow: 'hidden',
							}}
							cornerSmoothing={0.6}
						>
							<Image
								source={coverRef}
								style={{
									width: coverSize,
									height: coverSize,
								}}
								recyclingKey={currentTrack.uniqueKey}
								cachePolicy={'disk'}
								transition={300}
							/>
						</SquircleView>
					)}
				</TouchableOpacity>
			</Pressable>

			<View style={styles.trackInfoContainer}>
				<View style={styles.trackTitleContainer}>
					<View style={styles.trackTitleTextContainer}>
						<TouchableRipple
							onPress={() => setIsTitleExpanded((expanded) => !expanded)}
						>
							<Text
								variant='titleLarge'
								style={styles.trackTitle}
								numberOfLines={isTitleExpanded ? undefined : 1}
								ellipsizeMode='tail'
							>
								{currentTrack.title}
							</Text>
						</TouchableRipple>
						{currentTrack.artist?.name && (
							<View style={styles.artistRow}>
								<TouchableRipple
									onPress={onArtistPress}
									style={styles.artistName}
								>
									<Text
										variant='bodyMedium'
										style={{ color: colors.onSurfaceVariant }}
										numberOfLines={1}
									>
										{currentTrack.artist.name}
									</Text>
								</TouchableRipple>
								{canFollow && (
									<Button
										compact
										mode={isFollowed ? 'text' : 'outlined'}
										disabled={isRelationPending || isRelationMutationPending}
										onPress={onFollowPress}
										style={styles.followButton}
									>
										{isFollowed ? '已关注' : '关注'}
									</Button>
								)}
							</View>
						)}
					</View>
					{isBilibiliVideo && (
						<View style={styles.thumbUpButtonContainer}>
							<SkinThumbUpBurst
								skin={activeSkin}
								playSignal={favoriteBurstSignal}
							/>
							<IconButton
								icon={isInDefaultFavorite ? 'heart' : 'heart-outline'}
								size={24}
								iconColor={
									isInDefaultFavorite ? colors.error : colors.onSurfaceVariant
								}
								disabled={isFavoriteStatusFetching}
								loading={isFavoriteMutationPending}
								onPress={onFavoritePress}
							/>
						</View>
					)}
				</View>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	coverContainer: {
		alignItems: 'center',
		justifyContent: 'center',
		height: COVER_SIZE_RECT + 48,
		paddingHorizontal: 32,
	},
	coverGradient: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
	},
	coverPlaceholderText: {
		fontWeight: 'bold',
		color: 'rgba(255, 255, 255, 0.7)',
	},
	trackInfoContainer: {
		paddingHorizontal: 24,
	},
	trackTitleContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	trackTitleTextContainer: {
		flex: 1,
		marginRight: 8,
	},
	trackTitle: {
		fontWeight: 'bold',
	},
	artistRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	artistName: {
		flexShrink: 1,
	},
	followButton: {
		minWidth: 64,
	},
	thumbUpButtonContainer: {
		position: 'relative',
	},
})
