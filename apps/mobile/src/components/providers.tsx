import { useRequireProfilerDevTools } from '@rozenite/require-profiler-plugin'
import {
	createMMKVStorageAdapter,
	useRozeniteStoragePlugin,
} from '@rozenite/storage-plugin'
import { useTanStackQueryDevTools } from '@rozenite/tanstack-query-plugin'
import * as Sentry from '@sentry/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import Color from 'color'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Appearance, StyleSheet, useColorScheme, View } from 'react-native'
import { SystemBars } from 'react-native-edge-to-edge'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import RNShake from 'react-native-shake'

import GlobalErrorFallback from '@/components/ErrorBoundary'
import { alert } from '@/components/modals/AlertModal'
import useAppStore from '@/hooks/stores/useAppStore'
import { useModalStore } from '@/hooks/stores/useModalStore'
import useSkinStore from '@/hooks/stores/useSkinStore'
import {
	ActiveSkinProvider,
	useLoadActiveSkin,
} from '@/hooks/theme/useActiveSkin'
import { queryClient } from '@/lib/config/queryClient'
import {
	captureProfiling,
	isShakeProfilingEnabled,
	PROFILING_DURATION_MS,
} from '@/lib/performance'
import {
	getActiveSkinColorScheme,
	getColorSchemePreference,
	resolveColorScheme,
} from '@/lib/theme/colorScheme'
import type { ResolvedColorScheme } from '@/lib/theme/colorScheme'
import { buildMaterial3PaperColors } from '@/lib/theme/material3Colors'
import type { AppSkin } from '@/lib/theme/types'
import { storage } from '@/utils/mmkv'

const resolveSkinColor = (value: string | null | undefined): string | null => {
	if (!value) return null
	try {
		return Color(value).hex()
	} catch {
		return null
	}
}

const ensureAccentContrast = (
	accent: string,
	surface: string,
	darkMode: boolean,
): string => {
	const accentColor = Color(accent)
	const surfaceColor = Color(surface)
	if (accentColor.contrast(surfaceColor) >= 3) return accentColor.hex()

	const contrastTarget = Color(darkMode ? '#FFFFFF' : '#000000')
	for (let amount = 0.08; amount <= 1; amount += 0.08) {
		const candidate = accentColor.mix(contrastTarget, Math.min(amount, 1))
		if (candidate.contrast(surfaceColor) >= 3) return candidate.hex()
	}

	return contrastTarget.hex()
}

const applySkinAccent = (
	base: ReturnType<typeof buildMaterial3PaperColors>,
	skin: AppSkin | null,
	skinIndex: number,
	darkMode: boolean,
) => {
	const skinColors = skin?.skins[skinIndex]?.colors
	const rawPrimary = resolveSkinColor(skinColors?.color)
	if (!rawPrimary) return base

	const primary = ensureAccentContrast(rawPrimary, base.surface, darkMode)
	const primaryColor = Color(primary)
	const rawSecondary =
		resolveSkinColor(skinColors?.colorSecondPage) ?? rawPrimary
	const secondary = ensureAccentContrast(rawSecondary, base.surface, darkMode)
	const secondaryColor = Color(secondary)
	return {
		...base,
		primary,
		onPrimary: primaryColor.isDark() ? '#FFFFFF' : '#000000',
		primaryContainer: Color(base.primaryContainer)
			.mix(primaryColor, 0.72)
			.hex(),
		onPrimaryContainer: primaryColor.isDark() ? '#FFFFFF' : '#000000',
		secondary,
		onSecondary: secondaryColor.isDark() ? '#FFFFFF' : '#000000',
		secondaryContainer: Color(base.secondaryContainer)
			.mix(secondaryColor, 0.72)
			.hex(),
		onSecondaryContainer: secondaryColor.isDark() ? '#FFFFFF' : '#000000',
		inversePrimary: Color(base.inversePrimary).mix(primaryColor, 0.72).hex(),
	}
}

function DevTools() {
	useTanStackQueryDevTools(queryClient)
	useRozeniteStoragePlugin({
		storages: [
			createMMKVStorageAdapter({
				storages: {
					app: storage,
				},
			}),
		],
	})
	useRequireProfilerDevTools()
	return null
}

function ShakeProfiler() {
	const promptVisibleRef = useRef(false)

	useEffect(() => {
		const subscription = RNShake.addListener(() => {
			if (!isShakeProfilingEnabled() || promptVisibleRef.current) return
			promptVisibleRef.current = true

			alert(
				'记录性能分析',
				'是否记录接下来 10 秒的性能分析？完成后会保存到 Downloads 文件夹。',
				[
					{
						text: '取消',
						onPress: () => {
							promptVisibleRef.current = false
							useModalStore.getState().close('Alert')
						},
					},
					{
						text: '开始记录',
						onPress: () => {
							promptVisibleRef.current = false
							void captureProfiling(PROFILING_DURATION_MS)
						},
					},
				],
			)
		})

		return () => subscription.remove()
	}, [])

	return null
}

export default function AppProviders({ children }: { children: ReactNode }) {
	const systemColorScheme = useColorScheme()
	const themeMode = useAppStore((state) => state.settings.themeMode)
	const activeSkin = useLoadActiveSkin()
	const activeSkinIndex = useSkinStore((state) => state.activeSkinIndex)
	const skinColorScheme = getActiveSkinColorScheme(activeSkin, activeSkinIndex)
	const colorSchemePreference = getColorSchemePreference(
		themeMode,
		skinColorScheme,
	)
	const colorScheme = resolveColorScheme(
		colorSchemePreference,
		systemColorScheme,
	)
	const [appliedColorSchemePreference, setAppliedColorSchemePreference] =
		useState<ResolvedColorScheme | null>()

	useEffect(() => {
		Appearance.setColorScheme(colorSchemePreference ?? 'unspecified')
		// This tracks completion of the imperative native update so Material You
		// colors are never read using the previous mode.
		// oxlint-disable-next-line react-you-might-not-need-an-effect/no-derived-state
		setAppliedColorSchemePreference(colorSchemePreference)
	}, [colorSchemePreference])

	const paperTheme = useMemo(() => {
		const baseTheme = colorScheme === 'dark' ? MD3DarkTheme : MD3LightTheme
		const baseColors = buildMaterial3PaperColors(
			colorScheme,
			appliedColorSchemePreference === colorSchemePreference,
		)
		return {
			...baseTheme,
			colors: applySkinAccent(
				baseColors,
				activeSkin,
				activeSkinIndex,
				colorScheme === 'dark',
			),
		}
	}, [
		activeSkin,
		activeSkinIndex,
		appliedColorSchemePreference,
		colorScheme,
		colorSchemePreference,
	])

	return (
		<SafeAreaProvider>
			<KeyboardProvider>
				<View style={styles.container}>
					<Sentry.ErrorBoundary
						// oxlint-disable-next-line @typescript-eslint/unbound-method
						fallback={({ error, resetError }) => (
							<GlobalErrorFallback
								error={error}
								resetError={resetError}
							/>
						)}
					>
						<GestureHandlerRootView style={styles.container}>
							<QueryClientProvider client={queryClient}>
								<ActiveSkinProvider skin={activeSkin}>
									<PaperProvider theme={paperTheme}>
										{__DEV__ ? <DevTools /> : null}
										<ShakeProfiler />
										{children}
									</PaperProvider>
								</ActiveSkinProvider>
							</QueryClientProvider>
						</GestureHandlerRootView>
					</Sentry.ErrorBoundary>
					<SystemBars style={colorScheme === 'dark' ? 'light' : 'dark'} />
				</View>
			</KeyboardProvider>
		</SafeAreaProvider>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
})
