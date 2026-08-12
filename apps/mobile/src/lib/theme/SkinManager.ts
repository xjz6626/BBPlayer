/**
 * 阶段三：皮肤生命周期编排器
 *
 * 职责：
 * - 串联 adapter → downloadManager → transformer 全流程
 * - 安装到 cacheDirectory 临时目录，完成后移动到 skins/ 永久目录
 * - 注册表通过 useSkinStore（Zustand → MMKV）维护
 * - 提供安装、卸载、列表、查询接口
 */

import * as FileSystem from 'expo-file-system'
import { okAsync, ResultAsync } from 'neverthrow'

import useSkinStore from '@/hooks/stores/useSkinStore'
import type { GarbSkinSearchResult } from '@/lib/api/bilibili/garb'
import { ServiceError } from '@/lib/errors'
import {
	createSkinInstallFailed,
	createSkinUninstallFailed,
} from '@/lib/errors/service'
import log from '@/utils/log'
import { storage } from '@/utils/mmkv'

import { fetchGarbSkinAssetDeclaration } from './adapter'
import { downloadManifestAssets } from './downloadManager'
import { transformManifestToInstalledSkin } from './transformer'
import type { InstalledSkin, InstalledSkinMeta } from './types'

// ============================================================
// 路径
// ============================================================

const getSkinsDir = () =>
	new FileSystem.Directory(FileSystem.Paths.document, 'skins/')

const ensureSkinsDir = () => {
	const skinsDir = getSkinsDir()
	if (!skinsDir.exists) {
		skinsDir.create({ idempotent: true, intermediates: true })
	}
	return skinsDir
}

// ============================================================
// Skin ID 推导
// ============================================================

const deriveSkinId = (item: GarbSkinSearchResult): string => {
	if (
		item.kind === 'collection' &&
		item.actId !== null &&
		item.lotteryId !== null
	) {
		return `collection_${item.actId}_${item.lotteryId}`
	}
	if (item.kind === 'suit' && item.itemId !== null) {
		return `suit_${item.itemId}`
	}
	if (item.kind === 'collection') {
		throw new Error('收藏集搜索结果缺少 act_id 或 lottery_id')
	}
	if (item.kind === 'suit') {
		throw new Error('主题装扮搜索结果缺少 item_id')
	}
	throw new Error('当前装扮类型暂不支持下载')
}

const deriveSkinIdFromSource = (source: InstalledSkin['source']): string => {
	if (source.kind === 'collection')
		return `collection_${source.actId}_${source.lotteryId}`
	return `suit_${source.itemId}`
}

// ============================================================
// 皮肤 JSON 读写（每个 skin 目录内的 skin.json）
// ============================================================

const skinJsonFile = (skinId: string): FileSystem.File =>
	new FileSystem.File(
		new FileSystem.Directory(getSkinsDir(), `${skinId}/`),
		'skin.json',
	)

const readSkinJson = async (skinId: string): Promise<InstalledSkin | null> => {
	const file = skinJsonFile(skinId)
	if (!file.exists) return null
	try {
		const text = await file.text()
		return JSON.parse(text) as InstalledSkin
	} catch {
		return null
	}
}

const writeSkinJson = async (
	skin: InstalledSkin,
	dir: FileSystem.Directory,
): Promise<void> => {
	const file = new FileSystem.File(dir, 'skin.json')
	file.write(JSON.stringify(skin, null, 2))
}

// ============================================================
// 安装
// ============================================================

export interface InstallSkinOptions {
	onProgress?: (progress: {
		completed: number
		label: string
		progress: number
		total: number
	}) => void
	signal?: AbortSignal
}

export const installSkin = (
	item: GarbSkinSearchResult,
	options: InstallSkinOptions = {},
): ResultAsync<InstalledSkin, ServiceError> => {
	return ResultAsync.fromPromise(
		(async () => {
			const skinId = deriveSkinId(item)
			log.debug('[skin-mgr] install started', {
				skinId,
				kind: item.kind,
				name: item.name,
			})

			const manifestResult = await fetchGarbSkinAssetDeclaration(
				item,
				options.signal,
			)
			if (manifestResult.isErr()) throw manifestResult.error
			const manifest = manifestResult.value

			const tempDir = new FileSystem.Directory(
				FileSystem.Paths.cache ?? FileSystem.Paths.document,
				`skin-install-${Date.now().toString(36)}/`,
			)
			try {
				tempDir.create({ idempotent: true, intermediates: true })

				const downloadResult = await downloadManifestAssets({
					manifest,
					outputDirectory: tempDir,
					onProgress: options.onProgress,
					signal: options.signal,
				})
				if (downloadResult.isErr()) throw downloadResult.error

				const skinsDir = ensureSkinsDir()
				const finalDir = new FileSystem.Directory(skinsDir, `${skinId}/`)
				const source =
					item.kind === 'collection'
						? ({
								actId: item.actId!,
								kind: 'collection',
								lotteryId: item.lotteryId!,
							} as const)
						: ({
								itemId: item.itemId!,
								kind: 'suit',
							} as const)

				const transformResult = transformManifestToInstalledSkin({
					manifest,
					mapping: downloadResult.value.mapping,
					rootUri: finalDir.uri,
					skinId,
					source,
				})
				if (transformResult.isErr()) throw transformResult.error
				const installedSkin = transformResult.value

				await writeSkinJson(installedSkin, tempDir)

				if (finalDir.exists) {
					finalDir.delete()
					useSkinStore.getState().removeInstalledSkin(skinId)
				}

				await tempDir.move(finalDir)
				useSkinStore.getState().addInstalledSkin(installedSkin)

				log.debug('[skin-mgr] install completed', {
					skinId,
					finalDir: finalDir.uri,
				})
				return installedSkin
			} catch (error) {
				if (tempDir.exists) {
					try {
						tempDir.delete()
					} catch {
						// ignore
					}
				}
				throw error
			}
		})(),
		(error) => {
			log.error('[skin-mgr] install failed', {
				name: item.name,
				error: error instanceof Error ? error.message : String(error),
			})
			return error instanceof ServiceError
				? error
				: createSkinInstallFailed(
						error instanceof Error ? error.message : String(error),
						error,
					)
		},
	)
}

// ============================================================
// 卸载
// ============================================================

export const uninstallSkin = (
	skinId: string,
): ResultAsync<void, ServiceError> => {
	log.debug('[skin-mgr] uninstall started', { skinId })
	const store = useSkinStore.getState()
	if (!store.installedSkins.some((e) => e.id === skinId)) {
		log.debug('[skin-mgr] uninstall skipped: not installed', { skinId })
		return okAsync(undefined)
	}

	return ResultAsync.fromPromise(
		(async () => {
			const dir = new FileSystem.Directory(getSkinsDir(), `${skinId}/`)
			if (dir.exists) {
				dir.delete()
			}

			store.removeInstalledSkin(skinId)
			storage.remove('boot_splash_preload')
			log.debug('[skin-mgr] uninstall completed', { skinId })
		})(),
		(e) =>
			createSkinUninstallFailed(e instanceof Error ? e.message : String(e), e),
	)
}

export const uninstallSkinBySource = (
	source: InstalledSkin['source'],
): ResultAsync<void, ServiceError> => {
	return uninstallSkin(deriveSkinIdFromSource(source))
}

// ============================================================
// 列表
// ============================================================

export const getInstalledSkins = (): InstalledSkinMeta[] => {
	return useSkinStore.getState().installedSkins
}

// ============================================================
// 查询
// ============================================================

export const getInstalledSkin = async (
	skinId: string,
): Promise<InstalledSkin | null> => {
	return readSkinJson(skinId)
}

export const getInstalledSkinBySource = async (
	source: InstalledSkin['source'],
): Promise<InstalledSkin | null> => {
	return readSkinJson(deriveSkinIdFromSource(source))
}

export const getInstalledSkinMeta = (
	skinId: string,
): InstalledSkinMeta | null => {
	return (
		useSkinStore.getState().installedSkins.find((e) => e.id === skinId) ?? null
	)
}

export const isSkinInstalled = (item: GarbSkinSearchResult): boolean => {
	const skinId = deriveSkinId(item)
	return useSkinStore.getState().installedSkins.some((e) => e.id === skinId)
}
