import * as Sentry from '@sentry/react-native'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { err, ok, type Result } from 'neverthrow'
import { fetch, prefetchOnAppStart } from 'react-native-nitro-fetch'

const UPDATE_PREFETCH_KEY = 'update-manifest'

export interface ReleaseInfo {
	buildCommit?: string
	version: string
	notes: string
	listed_notes?: string[]
	url: string
	downloads?: UpdateDownloads
	forced: boolean
}

export interface UpdateDownloads {
	android?: Record<string, string>
}

interface UpdateSourceConfig {
	buildCommit?: string
	updateReleaseTag?: string
	updateRepository?: string
}

const getUpdateSourceConfig = (): UpdateSourceConfig => {
	const extra = Constants?.expoConfig?.extra as UpdateSourceConfig | undefined
	return extra ?? {}
}

export function registerUpdatePrefetch(): void {
	const manifestUrl = getManifestUrl()
	if (!manifestUrl) return
	void prefetchOnAppStart(manifestUrl, { prefetchKey: UPDATE_PREFETCH_KEY })
}

const getManifestUrl = (): string | undefined => {
	const { updateRepository, updateReleaseTag } = getUpdateSourceConfig()
	if (!updateRepository || !updateReleaseTag) return undefined
	return `https://github.com/${updateRepository}/releases/download/${encodeURIComponent(updateReleaseTag)}/nightly-update.json`
}

const toError = (e: unknown): Error =>
	e instanceof Error ? e : new Error(String(e))

const normalizeVersion = (v?: string | null): string => {
	if (!v) return '0.0.0'
	return v.startsWith('v') ? v.slice(1) : v
}

export const compareSemver = (a: string, b: string): number => {
	const pa = normalizeVersion(a)
		.split('.')
		.map((n) => parseInt(n, 10) || 0)
	const pb = normalizeVersion(b)
		.split('.')
		.map((n) => parseInt(n, 10) || 0)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const ai = pa[i] ?? 0
		const bi = pb[i] ?? 0
		if (ai > bi) return 1
		if (ai < bi) return -1
	}
	return 0
}

export async function fetchLatestRelease(): Promise<
	Result<ReleaseInfo, Error>
> {
	try {
		const { updateReleaseTag, updateRepository } = getUpdateSourceConfig()
		if (!updateRepository || !updateReleaseTag) {
			return err(new Error('未在 app.config 中配置 GitHub 更新渠道'))
		}

		const manifestUrl = `https://github.com/${updateRepository}/releases/download/${encodeURIComponent(updateReleaseTag)}/nightly-update.json`
		const requestOptions: RequestInit = {
			cache: 'no-store',
			headers: {
				Accept: 'application/json',
			},
		}
		const response = await Sentry.startSpan(
			{ name: 'http:fetch:github-nightly-manifest', op: 'http' },
			() => fetch(manifestUrl, requestOptions),
		)
		if (!response.ok) {
			return err(
				new Error(
					`Nightly 更新清单请求失败: ${response.status} ${response.statusText}`,
				),
			)
		}

		const releaseInfo = parseReleaseInfo(await response.json())
		if (!releaseInfo) return err(new Error('Nightly 更新清单格式错误'))
		return ok(releaseInfo)
	} catch (e) {
		return err(toError(e))
	}
}

/**
 * 检查是否有新版本
 * @returns 如果没有新的版本，返回的 update 为 null
 */
export async function checkForAppUpdate(): Promise<
	Result<{ update: ReleaseInfo | null; currentVersion: string }, Error>
> {
	const currentVersion = normalizeVersion(
		Application.nativeApplicationVersion ?? '0.0.0',
	)
	const latest = await fetchLatestRelease()
	if (latest.isErr()) return err(latest.error)
	const info = latest.value
	const currentBuildCommit = getUpdateSourceConfig().buildCommit?.toLowerCase()
	if (info.buildCommit) {
		if (currentBuildCommit === info.buildCommit.toLowerCase()) {
			return ok({ update: null, currentVersion })
		}
		return ok({ update: info, currentVersion })
	}
	if (compareSemver(info.version, currentVersion) <= 0) {
		return ok({ update: null, currentVersion })
	}
	return ok({ update: info, currentVersion })
}

const parseReleaseInfo = (value: unknown): ReleaseInfo | undefined => {
	if (typeof value !== 'object' || value === null) return undefined
	const manifest = value as Record<string, unknown>
	const buildCommit = manifest.buildCommit
	const version = manifest.version
	const notes = manifest.notes
	const url = manifest.url
	const forced = manifest.forced
	const downloads = parseUpdateDownloads(manifest.downloads)
	if (
		typeof buildCommit !== 'string' ||
		typeof version !== 'string' ||
		typeof notes !== 'string' ||
		typeof url !== 'string' ||
		typeof forced !== 'boolean' ||
		!downloads
	) {
		return undefined
	}
	const listedNotes = manifest.listed_notes
	return {
		buildCommit,
		version,
		notes,
		url,
		downloads,
		forced,
		...(Array.isArray(listedNotes) &&
		listedNotes.every((item) => typeof item === 'string')
			? { listed_notes: listedNotes }
			: {}),
	}
}

const parseUpdateDownloads = (value: unknown): UpdateDownloads | undefined => {
	if (typeof value !== 'object' || value === null) return undefined
	const android = (value as Record<string, unknown>).android
	if (typeof android !== 'object' || android === null) return undefined
	const entries = Object.entries(android).filter(
		(entry): entry is [string, string] => typeof entry[1] === 'string',
	)
	return entries.length > 0
		? { android: Object.fromEntries(entries) }
		: undefined
}
