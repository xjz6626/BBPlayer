import { memo, useEffect, useRef, useState } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet, View } from 'react-native'
import { RNSvgaPlayer, SvgaPlayerRef } from 'rn-newarch-svga-player'

import useSkinStore from '@/hooks/stores/useSkinStore'
import type { AppSkin } from '@/lib/theme/types'
import log from '@/utils/log'

interface SkinThumbUpBurstProps {
	playSignal: number
	size?: number
	skin: AppSkin | null
	style?: StyleProp<ViewStyle>
}

const DEFAULT_SIZE = 96

const SkinThumbUpBurst = memo(function SkinThumbUpBurst({
	playSignal,
	size = DEFAULT_SIZE,
	skin,
	style,
}: SkinThumbUpBurstProps) {
	const [visible, setVisible] = useState(false)
	const playerRef = useRef<SvgaPlayerRef>(null)

	const thumbUpIndex = useSkinStore((state) => state.activeThumbUpIndex)
	const thumbUp = skin?.thumbUps[thumbUpIndex]
	const animation = thumbUp?.animation
	const playbackDuration = thumbUp?.durationMs ?? 2000

	useEffect(() => {
		if (!animation || playSignal === 0) return

		log.debug('[thumbUp] svga animation start', {
			animation,
			durationMs: playbackDuration,
		})

		setVisible(true)
		playerRef.current?.startAnimation()

		const hideTimer = setTimeout(
			() => setVisible(false),
			playbackDuration + 520,
		)
		return () => clearTimeout(hideTimer)
	}, [animation, playSignal, playbackDuration])

	if (!visible || !animation) return null

	return (
		<View
			pointerEvents='none'
			style={[styles.container, { height: size, width: size }, style]}
		>
			<RNSvgaPlayer
				ref={playerRef}
				source={animation}
				autoPlay
				loops={1}
				clearsAfterStop={false}
				style={{ height: size, width: size }}
			/>
		</View>
	)
})

const styles = StyleSheet.create({
	container: {
		position: 'absolute',
		right: -25,
		bottom: 40,
		zIndex: 10,
	},
})

export default SkinThumbUpBurst
