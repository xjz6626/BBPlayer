import { Color } from 'expo-router'
import type { ColorSchemeName } from 'react-native'
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper'
import type { MD3Colors } from 'react-native-paper/lib/typescript/types'

/**
 * Build a React Native Paper MD3Colors object from Expo Router's dynamic Material 3 colors.
 */
export function buildMaterial3PaperColors(
	colorScheme: ColorSchemeName,
	useDynamicColors = true,
): MD3Colors {
	const d = useDynamicColors ? Color.android.dynamic : null
	const fallback =
		colorScheme === 'dark' ? MD3DarkTheme.colors : MD3LightTheme.colors

	return {
		primary: (d?.primary as string | null) ?? fallback.primary,
		primaryContainer:
			(d?.primaryContainer as string | null) ?? fallback.primaryContainer,
		secondary: (d?.secondary as string | null) ?? fallback.secondary,
		secondaryContainer:
			(d?.secondaryContainer as string | null) ?? fallback.secondaryContainer,
		tertiary: (d?.tertiary as string | null) ?? fallback.tertiary,
		tertiaryContainer:
			(d?.tertiaryContainer as string | null) ?? fallback.tertiaryContainer,
		surface: (d?.surface as string | null) ?? fallback.surface,
		surfaceVariant:
			(d?.surfaceVariant as string | null) ?? fallback.surfaceVariant,
		background: (d?.background as string | null) ?? fallback.background,
		error: (d?.error as string | null) ?? fallback.error,
		errorContainer:
			(d?.errorContainer as string | null) ?? fallback.errorContainer,
		onPrimary: (d?.onPrimary as string | null) ?? fallback.onPrimary,
		onPrimaryContainer:
			(d?.onPrimaryContainer as string | null) ?? fallback.onPrimaryContainer,
		onSecondary: (d?.onSecondary as string | null) ?? fallback.onSecondary,
		onSecondaryContainer:
			(d?.onSecondaryContainer as string | null) ??
			fallback.onSecondaryContainer,
		onTertiary: (d?.onTertiary as string | null) ?? fallback.onTertiary,
		onTertiaryContainer:
			(d?.onTertiaryContainer as string | null) ?? fallback.onTertiaryContainer,
		onSurface: (d?.onSurface as string | null) ?? fallback.onSurface,
		onSurfaceVariant:
			(d?.onSurfaceVariant as string | null) ?? fallback.onSurfaceVariant,
		onError: (d?.onError as string | null) ?? fallback.onError,
		onErrorContainer:
			(d?.onErrorContainer as string | null) ?? fallback.onErrorContainer,
		onBackground: (d?.onBackground as string | null) ?? fallback.onBackground,
		outline: (d?.outline as string | null) ?? fallback.outline,
		outlineVariant:
			(d?.outlineVariant as string | null) ?? fallback.outlineVariant,
		// Renamed in Expo Router: surfaceInverse → inverseSurface
		inverseSurface:
			(d?.surfaceInverse as string | null) ?? fallback.inverseSurface,
		inverseOnSurface:
			(d?.onSurfaceInverse as string | null) ?? fallback.inverseOnSurface,
		inversePrimary:
			(d?.primaryInverse as string | null) ?? fallback.inversePrimary,
		shadow: fallback.shadow,
		scrim: fallback.scrim,
		// Not available from Expo Router dynamic colors — use Paper defaults
		surfaceDisabled: fallback.surfaceDisabled,
		onSurfaceDisabled: fallback.onSurfaceDisabled,
		backdrop: fallback.backdrop,
		elevation: fallback.elevation,
	}
}
