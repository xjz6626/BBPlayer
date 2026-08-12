import type { ColorSchemeName } from 'react-native'

import type { AppSkin } from '@/lib/theme/types'
import type { AppThemeMode } from '@/types/core/appStore'

export type ResolvedColorScheme = 'light' | 'dark'

export function normalizeSkinColorMode(
	colorMode: string | null | undefined,
): ResolvedColorScheme | null {
	const normalized = colorMode?.trim().toLowerCase()
	return normalized === 'light' || normalized === 'dark' ? normalized : null
}

export function getActiveSkinColorScheme(
	skin: AppSkin | null,
	skinIndex: number,
): ResolvedColorScheme | null {
	return normalizeSkinColorMode(skin?.skins[skinIndex]?.colors.colorMode)
}

export function getColorSchemePreference(
	themeMode: AppThemeMode,
	skinColorScheme: ResolvedColorScheme | null,
): ResolvedColorScheme | null {
	if (skinColorScheme) return skinColorScheme
	return themeMode === 'system' ? null : themeMode
}

export function resolveColorScheme(
	preference: ResolvedColorScheme | null,
	systemColorScheme: ColorSchemeName,
): ResolvedColorScheme {
	return preference ?? (systemColorScheme === 'dark' ? 'dark' : 'light')
}
