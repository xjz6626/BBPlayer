import { useMutation } from '@tanstack/react-query'

import { bilibiliApi } from '@/lib/api/bilibili/api'
import { toastAndLogError } from '@/utils/error-handling'
import { returnOrThrowAsync } from '@/utils/neverthrow-utils'

export const useModifyDynamicThumb = () =>
	useMutation({
		mutationFn: ({ dynamicId, like }: { dynamicId: string; like: boolean }) =>
			returnOrThrowAsync(
				bilibiliApi.modifyDynamicThumb({ dynamicId, like }).map(() => true),
			),
		onError: (error) => {
			toastAndLogError('动态点赞失败', error, 'Mutation.Bilibili.Dynamic')
		},
	})
