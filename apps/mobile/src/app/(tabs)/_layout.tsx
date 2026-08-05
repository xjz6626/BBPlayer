import type {
	BottomTabBarProps,
	NativeBottomTabNavigationEventMap,
	NativeBottomTabNavigationOptions,
} from '@bottom-tabs/react-navigation'
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation'
import Icon from '@react-native-vector-icons/material-design-icons'
import Color from 'color'
import { withLayoutContext } from 'expo-router'
import type {
	ParamListBase,
	TabNavigationState,
} from 'expo-router/react-navigation'
import { useCallback, useMemo } from 'react'
import { useTheme } from 'react-native-paper'

import SkinBottomTabBar from '@/components/navigation/SkinBottomTabBar'
import { useBilibiliDynamicFeedUpdate } from '@/hooks/queries/bilibili/dynamic'
import useSkinStore from '@/hooks/stores/useSkinStore'
import useActiveSkin from '@/hooks/theme/useActiveSkin'

const BottomTabNavigator = createNativeBottomTabNavigator().Navigator

const Tabs = withLayoutContext<
	NativeBottomTabNavigationOptions,
	typeof BottomTabNavigator,
	TabNavigationState<ParamListBase>,
	NativeBottomTabNavigationEventMap
>(BottomTabNavigator)

interface nonNullableIcon {
	uri: string
	scale: number
}

const homeIcon = Icon.getImageSourceSync('home', 24) as nonNullableIcon
const libraryIcon = Icon.getImageSourceSync('bookshelf', 24) as nonNullableIcon
const settingsIcon = Icon.getImageSourceSync('cog', 24) as nonNullableIcon

const validColor = (value: string | null | undefined, fallback: string) => {
	if (!value) return fallback
	try {
		return Color(value).hex()
	} catch {
		return fallback
	}
}

export default function TabLayout() {
	const themes = useTheme().colors
	const { data: dynamicFeedUpdate } = useBilibiliDynamicFeedUpdate()
	const activeSkin = useActiveSkin()
	const activeSkinIndex = useSkinStore((state) => state.activeSkinIndex)
	const selectedSkin = activeSkin?.skins[activeSkinIndex]
	const skinIcons = selectedSkin?.tabBar.icons
	const skinTabBarBackground = selectedSkin?.tabBar.background
	const activeTabColor = validColor(
		selectedSkin?.colors.tailColorSelected,
		themes.primary,
	)
	const inactiveTabColor = validColor(
		selectedSkin?.colors.tailColor,
		themes.onSurfaceVariant,
	)
	const useSkinTabs = Boolean(
		skinIcons?.home.default &&
		skinIcons.home.selected &&
		skinIcons.library.default &&
		skinIcons.library.selected &&
		skinIcons.settings.default &&
		skinIcons.settings.selected,
	)
	const dynamicDefaultIcon = Icon.getImageSourceSync(
		'account-group-outline',
		24,
		themes.onSurfaceVariant,
	) as nonNullableIcon
	const dynamicSelectedIcon = Icon.getImageSourceSync(
		'account-group',
		24,
		themes.primary,
	) as nonNullableIcon
	const themedIconRoutes = useMemo(
		() =>
			[
				skinIcons?.home.default && skinIcons.home.selected ? 'index' : null,
				skinIcons?.library.default && skinIcons.library.selected
					? 'library/[tab]'
					: null,
				skinIcons?.dynamic?.default && skinIcons.dynamic.selected
					? 'dynamic'
					: null,
				skinIcons?.settings.default && skinIcons.settings.selected
					? 'settings/index'
					: null,
			].filter((route): route is string => route !== null),
		[skinIcons],
	)
	const renderSkinTabBar = useCallback(
		(props: BottomTabBarProps) =>
			skinTabBarBackground ? (
				<SkinBottomTabBar
					{...props}
					activeColor={activeTabColor}
					inactiveColor={inactiveTabColor}
					background={skinTabBarBackground}
					fallbackBackgroundColor={themes.elevation.level1}
					themedIconRoutes={themedIconRoutes}
				/>
			) : null,
		[
			activeTabColor,
			inactiveTabColor,
			skinTabBarBackground,
			themedIconRoutes,
			themes.elevation.level1,
		],
	)

	return (
		<Tabs
			disablePageAnimations
			disableTintColor={useSkinTabs}
			iconSize={useSkinTabs ? 50 : undefined}
			tabBar={skinTabBarBackground ? renderSkinTabBar : undefined}
			tabBarActiveTintColor={activeTabColor}
			tabBarInactiveTintColor={inactiveTabColor}
			activeIndicatorColor={'transparent'}
			tabBarStyle={{ backgroundColor: themes.elevation.level1 }}
			initialRouteName='index'
		>
			<Tabs.Screen
				name='index'
				options={{
					title: '主页',
					tabBarIcon: ({ focused }) => {
						const icon = focused
							? skinIcons?.home.selected
							: skinIcons?.home.default
						return icon ? { uri: icon, scale: 1 } : homeIcon
					},
					tabBarLabel: '主页',
					lazy: true,
				}}
			/>
			<Tabs.Screen
				name='library/[tab]'
				options={{
					title: '音乐库',
					tabBarIcon: ({ focused }) => {
						const icon = focused
							? skinIcons?.library.selected
							: skinIcons?.library.default
						return icon ? { uri: icon, scale: 1 } : libraryIcon
					},
					tabBarLabel: '音乐库',
					lazy: true,
				}}
			/>
			<Tabs.Screen
				name='dynamic'
				options={{
					title: '关注动态',
					tabBarIcon: ({ focused }) => {
						const icon = focused
							? skinIcons?.dynamic?.selected
							: skinIcons?.dynamic?.default
						return icon
							? { uri: icon, scale: 1 }
							: focused
								? dynamicSelectedIcon
								: dynamicDefaultIcon
					},
					tabBarLabel: '动态',
					tabBarBadge:
						(dynamicFeedUpdate?.update_num ?? 0) > 0 ? ' ' : undefined,
					tabBarBadgeBackgroundColor: themes.error,
					tabBarBadgeTextColor: themes.onError,
					lazy: true,
				}}
			/>
			<Tabs.Screen
				name='settings/index'
				options={{
					title: '设置',
					tabBarIcon: ({ focused }) => {
						const icon = focused
							? skinIcons?.settings.selected
							: skinIcons?.settings.default
						return icon ? { uri: icon, scale: 1 } : settingsIcon
					},
					tabBarLabel: '设置',
					lazy: true,
				}}
			/>
		</Tabs>
	)
}
