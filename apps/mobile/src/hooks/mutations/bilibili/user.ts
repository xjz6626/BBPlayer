import { useMutation } from '@tanstack/react-query'

import { userQueryKeys } from '@/hooks/queries/bilibili/user'
import { bilibiliApi } from '@/lib/api/bilibili/api'
import type { BilibiliUserRelation } from '@/types/apis/bilibili'
import { toastAndLogError } from '@/utils/error-handling'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'
import toast from '@/utils/toast'

export const useModifyUserRelation = () =>
	useMutation({
		mutationFn: ({ mid, follow }: { mid: number; follow: boolean }) =>
			returnOrThrowAsync(
				bilibiliApi.modifyUserRelation({ mid, follow }).map(() => true),
			),
		onMutate: async ({ mid, follow }, context) => {
			const queryKey = userQueryKeys.relation(mid)
			await context.client.cancelQueries({ queryKey })
			const previous =
				context.client.getQueryData<BilibiliUserRelation>(queryKey)
			context.client.setQueryData<BilibiliUserRelation>(queryKey, {
				attribute: follow ? 2 : 0,
			})
			return { previous }
		},
		onSuccess: (_data, { follow }) => {
			toast.success(follow ? '关注成功' : '已取消关注')
		},
		onError: (error, { mid, follow }, onMutateResult, context) => {
			context.client.setQueryData(
				userQueryKeys.relation(mid),
				onMutateResult?.previous,
			)
			toastAndLogError(
				follow ? '关注失败' : '取消关注失败',
				error,
				'Mutation.Bilibili.User',
			)
		},
		onSettled: async (_data, _error, { mid }, _result, context) => {
			await context.client.invalidateQueries({
				queryKey: userQueryKeys.relation(mid),
			})
		},
	})
