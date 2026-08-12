import type { BottomTabBarProps } from '@bottom-tabs/react-navigation'
import { Image as ExpoImage } from 'expo-image'
import { CommonActions } from 'expo-router/react-navigation'
import { memo } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface SkinBottomTabBarProps extends BottomTabBarProps {
	activeColor: string
	background: string
	fallbackBackgroundColor: string
	inactiveColor: string
	themedIconRoutes: string[]
}

const TAB_BAR_HEIGHT = 64

const SkinBottomTabBar = memo(function SkinBottomTabBar({
	activeColor,
	background,
	descriptors,
	fallbackBackgroundColor,
	inactiveColor,
	navigation,
	state,
	themedIconRoutes,
}: SkinBottomTabBarProps) {
	const insets = useSafeAreaInsets()

	return (
		<View
			style={[
				styles.container,
				{
					backgroundColor: fallbackBackgroundColor,
					height: TAB_BAR_HEIGHT + insets.bottom,
					paddingBottom: insets.bottom,
				},
			]}
		>
			<ExpoImage
				source={background}
				contentFit='fill'
				cachePolicy='memory-disk'
				style={StyleSheet.absoluteFill}
			/>
			<View style={styles.tabRow}>
				{state.routes.map(
					(route: (typeof state.routes)[number], index: number) => {
						const descriptor = descriptors[route.key]
						if (!descriptor || descriptor.options.tabBarItemHidden) return null

						const options = descriptor.options
						const focused = state.index === index
						const color = focused ? activeColor : inactiveColor
						const icon = options.tabBarIcon?.({ focused })
						const label = options.tabBarLabel ?? options.title ?? route.name
						const isThemedIcon = themedIconRoutes.includes(route.name)

						const onPress = () => {
							const event = navigation.emit({
								type: 'tabPress',
								target: route.key,
								canPreventDefault: true,
							})
							if (
								!focused &&
								!event.defaultPrevented &&
								!options.preventsDefault
							) {
								navigation.dispatch({
									...CommonActions.navigate(route),
									target: state.key,
								})
							}
						}

						return (
							<Pressable
								key={route.key}
								testID={options.tabBarButtonTestID}
								accessibilityRole='tab'
								accessibilityLabel={label}
								accessibilityState={{ selected: focused }}
								onPress={onPress}
								onLongPress={() =>
									navigation.emit({
										type: 'tabLongPress',
										target: route.key,
									})
								}
								style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
							>
								<View style={styles.iconContainer}>
									{icon && !(typeof icon === 'object' && 'sfSymbol' in icon) ? (
										<Image
											source={icon}
											resizeMode='contain'
											style={[
												styles.icon,
												!isThemedIcon && { tintColor: color },
											]}
										/>
									) : null}
									{options.tabBarBadge !== undefined ? (
										<View
											style={[
												styles.badge,
												{
													backgroundColor:
														options.tabBarBadgeBackgroundColor ?? color,
												},
											]}
										>
											{options.tabBarBadge.trim() ? (
												<Text
													style={[
														styles.badgeText,
														{
															color: options.tabBarBadgeTextColor ?? '#FFFFFF',
														},
													]}
												>
													{options.tabBarBadge}
												</Text>
											) : null}
										</View>
									) : null}
								</View>
								<Text
									numberOfLines={1}
									style={[styles.label, { color }]}
								>
									{label}
								</Text>
							</Pressable>
						)
					},
				)}
			</View>
		</View>
	)
})

const styles = StyleSheet.create({
	container: {
		overflow: 'hidden',
	},
	tabRow: {
		flexDirection: 'row',
		height: TAB_BAR_HEIGHT,
	},
	tab: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingTop: 3,
		paddingHorizontal: 4,
	},
	pressed: {
		opacity: 0.72,
	},
	iconContainer: {
		height: 42,
		width: 52,
		alignItems: 'center',
		justifyContent: 'center',
	},
	icon: {
		height: 42,
		width: 42,
	},
	label: {
		fontSize: 11,
		fontWeight: '600',
		lineHeight: 14,
	},
	badge: {
		position: 'absolute',
		top: 2,
		right: 3,
		minWidth: 9,
		height: 9,
		borderRadius: 5,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 2,
	},
	badgeText: {
		fontSize: 8,
		fontWeight: '700',
		lineHeight: 9,
	},
})

export default SkinBottomTabBar
