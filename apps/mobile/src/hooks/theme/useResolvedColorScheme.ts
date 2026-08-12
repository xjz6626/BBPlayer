import { useTheme } from 'react-native-paper'

import type { ResolvedColorScheme } from '@/lib/theme/colorScheme'

/**
 * Returns the color scheme resolved by AppProviders after applying dynamic-skin
 * and in-app appearance preferences.
 */
export default function useResolvedColorScheme(): ResolvedColorScheme {
	return useTheme().dark ? 'dark' : 'light'
}
