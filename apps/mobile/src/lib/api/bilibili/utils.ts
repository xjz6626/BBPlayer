import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'

import useAppStore from '@/hooks/stores/useAppStore'
import { BilibiliApiError } from '@/lib/errors/thirdparty/bilibili'

export { av2bv, bv2av } from '@/utils/bilibiliId'

export function getCsrfToken(): Result<string, BilibiliApiError> {
	const cookieList = useAppStore.getState().bilibiliCookie
	if (!cookieList)
		return err(
			new BilibiliApiError({
				message: '未找到 Cookie',
				type: 'NoCookie',
			}),
		)
	const csrfToken = cookieList.bili_jct as string | undefined
	if (!csrfToken) {
		return err(
			new BilibiliApiError({
				message: '未找到 CSRF Token',
				type: 'CsrfError',
			}),
		)
	}
	return ok(csrfToken)
}
