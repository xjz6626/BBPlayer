import {
	createContext,
	createElement,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from 'react'

import useSkinStore from '@/hooks/stores/useSkinStore'
import { loadActiveSkin, invalidateSkinCache } from '@/lib/theme/runtime'
import type { AppSkin } from '@/lib/theme/types'

const ActiveSkinContext = createContext<AppSkin | null>(null)

export function useLoadActiveSkin(): AppSkin | null {
	const activeSkinId = useSkinStore((state) => state.activeSkinId)
	const installedSkins = useSkinStore((state) => state.installedSkins)

	const [appSkin, setAppSkin] = useState<AppSkin | null>(null)

	useEffect(() => {
		if (!activeSkinId) {
			setAppSkin(null)
			return
		}

		const meta = installedSkins.find((skin) => skin.id === activeSkinId)
		if (!meta) {
			setAppSkin(null)
			return
		}

		let cancelled = false

		void loadActiveSkin(meta).match(
			(skin) => {
				if (!cancelled) setAppSkin(skin)
			},
			() => {
				if (!cancelled) setAppSkin(null)
			},
		)

		return () => {
			cancelled = true
		}
	}, [activeSkinId, installedSkins])

	return appSkin
}

export function ActiveSkinProvider({
	children,
	skin,
}: {
	children: ReactNode
	skin: AppSkin | null
}) {
	return createElement(ActiveSkinContext.Provider, { value: skin }, children)
}

export default function useActiveSkin(): AppSkin | null {
	return useContext(ActiveSkinContext)
}

export { invalidateSkinCache }
