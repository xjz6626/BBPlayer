import { useRouter } from 'expo-router'
import { memo, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Dialog, ProgressBar, Text, useTheme } from 'react-native-paper'

import Button from '@/components/common/Button'
import { useModalStore } from '@/hooks/stores/useModalStore'
import type { GarbSkinSearchResult } from '@/lib/api/bilibili/garb'
import { installSkin } from '@/lib/theme/SkinManager'
import type { SkinDownloadProgress } from '@/lib/theme/types'
import toast from '@/utils/toast'

interface SkinDownloadProgressModalProps {
	item: GarbSkinSearchResult
}

const SkinDownloadProgressModal = memo(function SkinDownloadProgressModal({
	item,
}: SkinDownloadProgressModalProps) {
	const router = useRouter()
	const colors = useTheme().colors
	const close = useModalStore((state) => state.close)
	const [progress, setProgress] = useState<SkinDownloadProgress | null>(null)
	const [isFinished, setIsFinished] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const hasStarted = useRef(false)

	useEffect(() => {
		if (hasStarted.current) return
		hasStarted.current = true

		let cancelled = false
		const abortController = new AbortController()
		const handleError = (error: unknown) => {
			if (cancelled) return
			const message = error instanceof Error ? error.message : String(error)
			setErrorMessage(message || '未知错误')
			setIsFinished(true)
			toast.error(message || '主题下载失败')
		}

		try {
			void installSkin(item, {
				onProgress: (event) => {
					if (!cancelled) setProgress(event)
				},
				signal: abortController.signal,
			}).match(() => {
				if (cancelled) return
				useModalStore.getState().replace(
					'SkinDownloadProgress',
					'Alert',
					{
						buttons: [
							{ text: '稍后' },
							{
								text: '去启用',
								onPress: () => router.replace('/settings/appearance'),
							},
						],
						message: '是否现在去启用这个主题？',
						title: '主题下载完成',
					},
					{ dismissible: false },
				)
			}, handleError)
		} catch (error) {
			handleError(error)
		}

		return () => {
			cancelled = true
			abortController.abort()
		}
	}, [close, item, router])

	const hasError = errorMessage !== null

	return (
		<>
			<Dialog.Title>
				{hasError ? '下载失败' : isFinished ? '下载完成' : '正在下载主题资产'}
			</Dialog.Title>
			<Dialog.Content>
				<View style={styles.content}>
					<Text
						variant='bodySmall'
						numberOfLines={hasError ? undefined : 2}
						style={{ color: colors.onSurfaceVariant }}
					>
						{errorMessage ?? progress?.label ?? '正在获取资产清单'}
					</Text>
					<ProgressBar
						progress={hasError ? 0 : (progress?.progress ?? 0)}
						indeterminate={!progress && !isFinished}
						style={styles.progress}
					/>
					<Text
						variant='bodySmall'
						style={[styles.footer, { color: colors.onSurfaceVariant }]}
					>
						{hasError
							? '请关闭后重试'
							: progress && progress.total > 0
								? `${progress.completed}/${progress.total}`
								: '准备下载'}
					</Text>
				</View>
			</Dialog.Content>
			<Dialog.Actions>
				<Button onPress={() => close('SkinDownloadProgress')}>
					{isFinished ? '关闭' : '取消'}
				</Button>
			</Dialog.Actions>
		</>
	)
})

const styles = StyleSheet.create({
	content: {
		gap: 12,
	},
	progress: {
		height: 6,
		marginTop: 2,
		borderRadius: 3,
	},
	footer: {
		textAlign: 'right',
	},
})

export default SkinDownloadProgressModal
