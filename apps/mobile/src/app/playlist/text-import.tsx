import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	StyleSheet,
	View,
} from 'react-native'
import {
	Appbar,
	Divider,
	ProgressBar,
	Surface,
	Text,
	TextInput,
	useTheme,
} from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Button from '@/components/common/Button'
import { useImportBilibiliTextPlaylist } from '@/hooks/mutations/db/playlist'
import type { BilibiliTextImportFailure } from '@/lib/services/bilibiliTextPlaylistImportService'
import {
	formatBilibiliTextReference,
	parseBilibiliTextReferences,
} from '@/utils/bilibiliTextPlaylist'

interface ImportPageResult {
	playlistId: number
	savedCount: number
	failures: BilibiliTextImportFailure[]
	duplicateCount: number
}

export default function TextPlaylistImportPage() {
	const router = useRouter()
	const { colors } = useTheme()
	const insets = useSafeAreaInsets()
	const [title, setTitle] = useState('B站评论歌单')
	const [text, setText] = useState('')
	const [progress, setProgress] = useState({ completed: 0, total: 0 })
	const [result, setResult] = useState<ImportPageResult | null>(null)
	const abortControllerRef = useRef<AbortController | null>(null)
	const importMutation = useImportBilibiliTextPlaylist()
	const parsed = useMemo(() => parseBilibiliTextReferences(text), [text])

	useEffect(
		() => () => {
			abortControllerRef.current?.abort()
		},
		[],
	)

	const handleImport = async () => {
		if (!title.trim() || parsed.references.length === 0) return

		const controller = new AbortController()
		abortControllerRef.current = controller
		setResult(null)
		setProgress({ completed: 0, total: parsed.references.length })

		try {
			const imported = await importMutation.mutateAsync({
				title: title.trim(),
				text,
				signal: controller.signal,
				onProgress: setProgress,
			})
			setResult({
				playlistId: imported.playlistId,
				savedCount: imported.savedCount,
				failures: imported.failures,
				duplicateCount: imported.duplicateCount,
			})
		} catch {
			// Mutation 层统一显示错误；取消导入时不打扰用户。
		} finally {
			abortControllerRef.current = null
		}
	}

	const handlePaste = async () => {
		const clipboardText = await Clipboard.getStringAsync()
		if (!clipboardText) return
		setText(clipboardText)
		setResult(null)
	}

	const progressValue =
		progress.total > 0 ? progress.completed / progress.total : 0

	return (
		<KeyboardAvoidingView
			style={[styles.container, { backgroundColor: colors.background }]}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
		>
			<Appbar.Header>
				<Appbar.BackAction
					disabled={importMutation.isPending}
					onPress={() => router.back()}
				/>
				<Appbar.Content title='从评论文本导入' />
			</Appbar.Header>

			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={[
					styles.content,
					{ paddingBottom: insets.bottom + 24 },
				]}
				keyboardDismissMode='on-drag'
				keyboardShouldPersistTaps='handled'
				nestedScrollEnabled
			>
				<Text style={{ color: colors.onSurfaceVariant }}>
					粘贴从 B 站评论区复制的整段文字。应用会按出现顺序提取视频链接，支持
					BV、av、bilibili.com 和 b23.tv 短链接。
				</Text>

				<TextInput
					label='播放列表名称'
					value={title}
					onChangeText={(value) => {
						setTitle(value)
						setResult(null)
					}}
					mode='outlined'
					maxLength={100}
					disabled={importMutation.isPending}
				/>
				<View style={styles.pasteRow}>
					<Text variant='labelLarge'>评论文字</Text>
					<Button
						mode='text'
						compact
						icon='content-paste'
						disabled={importMutation.isPending}
						onPress={() => void handlePaste()}
					>
						粘贴剪贴板
					</Button>
				</View>
				<TextInput
					placeholder={
						'例如：\n1. 歌曲 A https://b23.tv/xxxx\n2. 歌曲 B BVxxxxxxxxxx'
					}
					value={text}
					onChangeText={(value) => {
						setText(value)
						setResult(null)
					}}
					mode='outlined'
					multiline
					numberOfLines={8}
					scrollEnabled
					textAlignVertical='top'
					style={styles.textInput}
					disabled={importMutation.isPending}
				/>

				<Surface
					elevation={0}
					style={[styles.summary, { backgroundColor: colors.surfaceVariant }]}
				>
					<Text variant='titleMedium'>
						已识别 {parsed.references.length} 条视频链接
					</Text>
					{parsed.duplicateCount > 0 && (
						<Text
							variant='bodySmall'
							style={{ color: colors.onSurfaceVariant }}
						>
							已自动去除 {parsed.duplicateCount} 条重复链接
						</Text>
					)}
					{parsed.references.slice(0, 6).map((reference) => (
						<Text
							key={`${reference.index}:${reference.raw}`}
							variant='bodySmall'
							numberOfLines={1}
							style={{ color: colors.onSurfaceVariant }}
						>
							• {formatBilibiliTextReference(reference)}
						</Text>
					))}
					{parsed.references.length > 6 && (
						<Text
							variant='bodySmall'
							style={{ color: colors.onSurfaceVariant }}
						>
							还有 {parsed.references.length - 6} 条……
						</Text>
					)}
				</Surface>

				{importMutation.isPending && (
					<View style={styles.progressContainer}>
						<View style={styles.progressTextRow}>
							<Text>正在获取视频信息</Text>
							<Text style={{ color: colors.onSurfaceVariant }}>
								{progress.completed}/{progress.total}
							</Text>
						</View>
						<ProgressBar progress={progressValue} />
					</View>
				)}

				<Button
					mode='contained'
					icon='playlist-plus'
					loading={importMutation.isPending}
					disabled={
						importMutation.isPending ||
						!title.trim() ||
						parsed.references.length === 0
					}
					contentStyle={styles.importButton}
					onPress={() => void handleImport()}
				>
					{importMutation.isPending ? '正在导入' : '创建播放列表'}
				</Button>

				{result && (
					<Surface
						elevation={1}
						style={[styles.result, { backgroundColor: colors.surface }]}
					>
						<Text variant='titleMedium'>导入完成</Text>
						<Text>
							成功保存 {result.savedCount} 首
							{result.failures.length > 0
								? `，失败 ${result.failures.length} 条`
								: ''}
							{result.duplicateCount > 0
								? `，去重 ${result.duplicateCount} 条`
								: ''}
						</Text>

						{result.failures.length > 0 && (
							<>
								<Divider />
								<Text variant='labelLarge'>未导入的链接</Text>
								{result.failures.slice(0, 20).map((failure) => (
									<View
										key={`${failure.reference}:${failure.reason}`}
										style={styles.failureItem}
									>
										<Text variant='bodySmall'>{failure.reference}</Text>
										<Text
											variant='bodySmall'
											style={{ color: colors.error }}
										>
											{failure.reason}
										</Text>
									</View>
								))}
							</>
						)}

						<Button
							mode='contained-tonal'
							onPress={() =>
								router.replace({
									pathname: '/playlist/local/[id]',
									params: { id: String(result.playlistId) },
								})
							}
						>
							打开播放列表
						</Button>
					</Surface>
				)}
			</ScrollView>
		</KeyboardAvoidingView>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	scrollView: {
		flex: 1,
	},
	content: {
		paddingHorizontal: 16,
		paddingTop: 12,
		gap: 16,
	},
	textInput: {
		height: 220,
		maxHeight: 220,
	},
	pasteRow: {
		marginBottom: -12,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	summary: {
		borderRadius: 16,
		padding: 16,
		gap: 6,
	},
	progressContainer: {
		gap: 8,
	},
	progressTextRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	importButton: {
		minHeight: 48,
	},
	result: {
		borderRadius: 16,
		padding: 16,
		gap: 12,
	},
	failureItem: {
		gap: 2,
	},
})
