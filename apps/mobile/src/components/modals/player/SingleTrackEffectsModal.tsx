import { Orpheus, type TrackAudioEffectProfile } from '@bbplayer/orpheus'
import { Slider } from '@expo/ui/community/slider'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Dialog, Text, useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import Button from '@/components/common/Button'
import useCurrentTrack from '@/hooks/player/useCurrentTrack'
import { useModalStore } from '@/hooks/stores/useModalStore'
import { toastAndLogError } from '@/utils/error-handling'

const DEFAULT_PROFILE: TrackAudioEffectProfile = {
	volumeDb: 0,
	vocalStrength: 0,
}

const SingleTrackEffectsModal = () => {
	const { colors } = useTheme()
	const close = useModalStore((state) => state.close)
	const currentTrack = useCurrentTrack()
	const trackId = currentTrack?.uniqueKey
	const [profile, setProfile] = useState(DEFAULT_PROFILE)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		let active = true
		setIsLoading(true)

		if (!trackId) {
			setProfile(DEFAULT_PROFILE)
			setIsLoading(false)
			return () => {
				active = false
			}
		}

		void Orpheus.getTrackAudioEffectProfile(trackId)
			.then((savedProfile) => {
				if (active) setProfile(savedProfile)
			})
			.catch((error: unknown) => {
				toastAndLogError('读取单曲音效失败', error, 'Modal.SingleTrackEffects')
			})
			.finally(() => {
				if (active) setIsLoading(false)
			})

		return () => {
			active = false
		}
	}, [trackId])

	const updateProfile = (changes: Partial<TrackAudioEffectProfile>): void => {
		if (!trackId) return
		const nextProfile = { ...profile, ...changes }
		setProfile(nextProfile)
		void Orpheus.setTrackAudioEffectProfile(
			trackId,
			nextProfile.volumeDb,
			nextProfile.vocalStrength,
		).catch((error: unknown) => {
			toastAndLogError('应用单曲音效失败', error, 'Modal.SingleTrackEffects')
		})
	}

	const resetProfile = async () => {
		if (!trackId) return
		try {
			await Orpheus.resetTrackAudioEffectProfile(trackId)
			setProfile(DEFAULT_PROFILE)
		} catch (error) {
			toastAndLogError('重置单曲音效失败', error, 'Modal.SingleTrackEffects')
		}
	}

	const volumeLabel = `${profile.volumeDb > 0 ? '+' : ''}${profile.volumeDb.toFixed(1)} dB`
	const vocalLabel = `${Math.round(profile.vocalStrength * 100)}%`

	return (
		<>
			<Dialog.Title>单曲音效</Dialog.Title>
			<Dialog.Content>
				<Text
					variant='bodyMedium'
					numberOfLines={2}
					style={styles.trackTitle}
				>
					{currentTrack?.title ?? '当前没有正在播放的歌曲'}
				</Text>
				{isLoading ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size={32} />
					</View>
				) : (
					<>
						<View style={styles.controlHeader}>
							<Text variant='titleMedium'>单曲音量</Text>
							<Text
								variant='labelLarge'
								style={{ color: colors.primary }}
							>
								{volumeLabel}
							</Text>
						</View>
						<Slider
							style={styles.slider}
							minimumValue={-12}
							maximumValue={6}
							step={0.5}
							value={profile.volumeDb}
							disabled={!trackId}
							onValueChange={(volumeDb) => updateProfile({ volumeDb })}
							minimumTrackTintColor={colors.primary}
							maximumTrackTintColor={colors.surfaceVariant}
						/>

						<View style={[styles.controlHeader, styles.vocalHeader]}>
							<Text variant='titleMedium'>人声凸显</Text>
							<Text
								variant='labelLarge'
								style={{ color: colors.primary }}
							>
								{vocalLabel}
							</Text>
						</View>
						<Slider
							style={styles.slider}
							minimumValue={0}
							maximumValue={1}
							step={0.05}
							value={profile.vocalStrength}
							disabled={!trackId}
							onValueChange={(vocalStrength) =>
								updateProfile({ vocalStrength })
							}
							minimumTrackTintColor={colors.primary}
							maximumTrackTintColor={colors.surfaceVariant}
						/>
					</>
				)}
				<Text
					variant='bodySmall'
					style={[styles.description, { color: colors.onSurfaceVariant }]}
				>
					只影响这首歌，切歌后自动使用下一首的设置；不会改变手机系统音量。
				</Text>
			</Dialog.Content>
			<Dialog.Actions>
				<Button
					disabled={!trackId || isLoading}
					onPress={resetProfile}
				>
					重置
				</Button>
				<Button onPress={() => close('SingleTrackEffects')}>关闭</Button>
			</Dialog.Actions>
		</>
	)
}

const styles = StyleSheet.create({
	trackTitle: {
		marginBottom: 20,
	},
	loadingContainer: {
		height: 152,
		alignItems: 'center',
		justifyContent: 'center',
	},
	controlHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	vocalHeader: {
		marginTop: 12,
	},
	slider: {
		width: '100%',
		height: 44,
	},
	description: {
		marginTop: 16,
		lineHeight: 18,
	},
})

export default SingleTrackEffectsModal
