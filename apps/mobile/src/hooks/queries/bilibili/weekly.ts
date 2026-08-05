import { useQuery } from '@tanstack/react-query'

import useAppStore from '@/hooks/stores/useAppStore'
import { getLatestWeeklyVocalRank } from '@/lib/services/weeklyVocalRank'

export const weeklyVocalRankQueryKey = [
	'bilibili',
	'weekly-vocal-rank',
] as const

export const useWeeklyVocalRank = () => {
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())

	return useQuery({
		queryKey: weeklyVocalRankQueryKey,
		queryFn: ({ signal }) => getLatestWeeklyVocalRank({ signal }),
		enabled: hasCookie,
		staleTime: 30 * 60 * 1000,
	})
}
