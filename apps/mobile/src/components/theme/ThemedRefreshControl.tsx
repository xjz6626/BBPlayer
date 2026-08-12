import { memo, type ReactNode } from 'react'
import {
	RefreshControl as NativeRefreshControl,
	type RefreshControlProps,
	StyleSheet,
	View,
} from 'react-native'
import { useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import useSkinStore from '@/hooks/stores/useSkinStore'
import useActiveSkin from '@/hooks/theme/useActiveSkin'

export const useHasThemedLoadingAnimation = (): boolean => {
	const activeSkin = useActiveSkin()
	const activeLoadingIndex = useSkinStore((state) => state.activeLoadingIndex)
	return Boolean(activeSkin?.loadings[activeLoadingIndex]?.animation)
}

const ThemedRefreshControl = memo(function ThemedRefreshControl(
	props: RefreshControlProps,
) {
	const colors = useTheme().colors
	const hasThemedLoading = useHasThemedLoadingAnimation()

	return (
		<NativeRefreshControl
			{...props}
			colors={
				hasThemedLoading ? ['transparent'] : (props.colors ?? [colors.primary])
			}
			progressBackgroundColor={
				hasThemedLoading
					? 'transparent'
					: (props.progressBackgroundColor ?? colors.surface)
			}
			tintColor={
				hasThemedLoading ? 'transparent' : (props.tintColor ?? colors.primary)
			}
		/>
	)
})

export const ThemedRefreshIndicator = memo(function ThemedRefreshIndicator({
	refreshing,
}: {
	refreshing: boolean
}) {
	const hasThemedLoading = useHasThemedLoadingAnimation()
	if (!refreshing || !hasThemedLoading) return null

	return (
		<View
			pointerEvents='none'
			style={styles.indicator}
		>
			<ActivityIndicator size='large' />
		</View>
	)
})

export const ThemedRefreshListHeader = memo(function ThemedRefreshListHeader({
	children,
	refreshing,
}: {
	children: ReactNode
	refreshing: boolean
}) {
	return (
		<>
			<ThemedRefreshIndicator refreshing={refreshing} />
			{children}
		</>
	)
})

const styles = StyleSheet.create({
	indicator: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 8,
	},
})

export default ThemedRefreshControl
