import { CircularWavyProgressIndicator, Host } from '@expo/ui/jetpack-compose'
import { align } from '@expo/ui/jetpack-compose/modifiers'
import { memo, useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import {
	ActivityIndicator as PaperActivityIndicator,
	type ActivityIndicatorProps as PaperActivityIndicatorProps,
	useTheme,
} from 'react-native-paper'
import { RNSvgaPlayer } from 'rn-newarch-svga-player'

import useSkinStore from '@/hooks/stores/useSkinStore'
import useActiveSkin from '@/hooks/theme/useActiveSkin'
import useResolvedColorScheme from '@/hooks/theme/useResolvedColorScheme'
import log from '@/utils/log'

const SMALL_INDICATOR_SIZE = 24
const LARGE_INDICATOR_SIZE = 48

export type ActivityIndicatorProps = Pick<
	PaperActivityIndicatorProps,
	'color' | 'size' | 'style'
>

const ActivityIndicator = memo(function ActivityIndicator({
	color,
	size = 'small',
	style,
}: ActivityIndicatorProps) {
	const { colors } = useTheme()
	const colorScheme = useResolvedColorScheme()
	const activeSkin = useActiveSkin()
	const activeLoadingIndex = useSkinStore((state) => state.activeLoadingIndex)
	const animation = activeSkin?.loadings[activeLoadingIndex]?.animation
	const [failedAnimation, setFailedAnimation] = useState<string | null>(null)
	const resolvedColor = color || colors.primary
	const indicatorSize =
		size === 'small'
			? SMALL_INDICATOR_SIZE
			: size === 'large'
				? LARGE_INDICATOR_SIZE
				: size

	useEffect(() => {
		setFailedAnimation(null)
	}, [animation])

	if (animation && failedAnimation !== animation) {
		return (
			<View
				style={[
					styles.container,
					{ height: indicatorSize, width: indicatorSize },
					style,
				]}
			>
				<RNSvgaPlayer
					source={animation}
					autoPlay
					loops={0}
					clearsAfterStop={false}
					onError={({ error }) => {
						log.warning('[loading] failed to play themed animation', {
							animation,
							error,
						})
						setFailedAnimation(animation)
					}}
					style={{ height: indicatorSize, width: indicatorSize }}
				/>
			</View>
		)
	}

	if (Platform.OS === 'android') {
		return (
			<Host
				colorScheme={colorScheme}
				style={[
					{
						width: indicatorSize,
						height: indicatorSize,
						justifyContent: 'center',
						alignItems: 'center',
					},
					style,
				]}
			>
				<CircularWavyProgressIndicator
					color={resolvedColor}
					modifiers={[align('center')]}
				/>
			</Host>
		)
	}

	return (
		<PaperActivityIndicator
			color={resolvedColor}
			size={size}
			style={style}
		/>
	)
})

const styles = StyleSheet.create({
	container: {
		alignItems: 'center',
		justifyContent: 'center',
	},
})

export default ActivityIndicator
