import { useInfiniteQuery } from '@tanstack/react-query'

import useAppStore from '@/hooks/stores/useAppStore'
import { getBilibiliMusicRecommendations } from '@/lib/services/bilibiliRecommendations'

export const recommendationQueryKeys = {
	all: ['bilibili', 'recommendation'] as const,
	music: () => [...recommendationQueryKeys.all, 'music'] as const,
}

export const useBilibiliMusicRecommendations = () => {
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())

	return useInfiniteQuery({
		queryKey: recommendationQueryKeys.music(),
		queryFn: ({ pageParam, signal }) =>
			getBilibiliMusicRecommendations({ freshIndex: pageParam, signal }),
		initialPageParam: 1,
		getNextPageParam: (_lastPage, _allPages, lastPageParam) =>
			lastPageParam + 1,
		enabled: hasCookie,
		staleTime: 5 * 60 * 1000,
	})
}
