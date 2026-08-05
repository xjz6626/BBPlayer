import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import useAppStore from '@/hooks/stores/useAppStore'
import { bilibiliApi } from '@/lib/api/bilibili/api'
import { queryClient } from '@/lib/config/queryClient'
import type { BilibiliDynamicFeedUpdate } from '@/types/apis/bilibili'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'

const UPDATE_INTERVAL = 5 * 60 * 1000

export const dynamicFeedQueryKeys = {
	all: ['bilibili', 'dynamicFeed'] as const,
	feed: (hostMid?: number) =>
		[...dynamicFeedQueryKeys.all, 'feed', hostMid ?? 'all'] as const,
	followings: (mid: number) =>
		[...dynamicFeedQueryKeys.all, 'followings', mid] as const,
	update: () => [...dynamicFeedQueryKeys.all, 'update'] as const,
}

export const useBilibiliDynamicFeed = (hostMid?: number) => {
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())

	return useInfiniteQuery({
		queryKey: dynamicFeedQueryKeys.feed(hostMid),
		queryFn: ({ pageParam, signal }) =>
			returnOrThrowAsync(
				bilibiliApi.getDynamicFeed({
					offset: pageParam || undefined,
					hostMid,
					signal,
				}),
			),
		initialPageParam: '',
		getNextPageParam: (lastPage) =>
			lastPage.has_more && lastPage.offset ? lastPage.offset : undefined,
		enabled: hasCookie,
		staleTime: 60 * 1000,
	})
}

export const useBilibiliFollowings = (mid?: number) => {
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())

	return useInfiniteQuery({
		queryKey: dynamicFeedQueryKeys.followings(mid ?? 0),
		queryFn: ({ pageParam, signal }) =>
			returnOrThrowAsync(
				bilibiliApi.getFollowingUsers({
					mid: mid!,
					page: pageParam,
					signal,
				}),
			),
		initialPageParam: 1,
		getNextPageParam: (lastPage, allPages, lastPageParam) => {
			const loaded = allPages.reduce(
				(total, page) => total + (page.list?.length ?? 0),
				0,
			)
			return loaded < lastPage.total ? lastPageParam + 1 : undefined
		},
		enabled: hasCookie && !!mid,
		staleTime: 5 * 60 * 1000,
	})
}

export const useBilibiliDynamicFeedUpdate = () => {
	const hasCookie = useAppStore((state) => state.hasBilibiliCookie())

	return useQuery({
		queryKey: dynamicFeedQueryKeys.update(),
		queryFn: async ({ signal }) => {
			const result = await bilibiliApi.getDynamicFeedUpdate({ signal })
			return result.isOk() ? result.value : { update_num: 0 }
		},
		enabled: hasCookie,
		staleTime: UPDATE_INTERVAL,
		refetchInterval: UPDATE_INTERVAL,
		refetchIntervalInBackground: false,
	})
}

export const dismissBilibiliDynamicFeedUpdate = () => {
	queryClient.setQueryData<BilibiliDynamicFeedUpdate>(
		dynamicFeedQueryKeys.update(),
		(previous) => ({ ...previous, update_num: 0 }),
	)
}
