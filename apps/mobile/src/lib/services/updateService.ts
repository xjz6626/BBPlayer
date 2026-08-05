import * as Sentry from '@sentry/react-native'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { err, ok, type Result } from 'neverthrow'

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

interface GitHubReleaseAsset {
	browser_download_url: string
	name: string
}

const getUpdateSourceConfig = (): UpdateSourceConfig => {
	const extra = Constants?.expoConfig?.extra as UpdateSourceConfig | undefined
	return extra ?? {}
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

		const apiBase = `https://api.github.com/repos/${updateRepository}`
		const requestOptions: RequestInit = {
			cache: 'no-store',
			headers: {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		}
		const [releaseResponse, tagResponse] = await Sentry.startSpan(
			{ name: 'http:fetch:github-nightly-release', op: 'http' },
			() =>
				Promise.all([
					fetch(
						`${apiBase}/releases/tags/${encodeURIComponent(updateReleaseTag)}`,
						requestOptions,
					),
					fetch(
						`${apiBase}/git/ref/tags/${encodeURIComponent(updateReleaseTag)}`,
						requestOptions,
					),
				]),
		)
		if (!releaseResponse.ok) {
			return err(
				new Error(
					`GitHub Release 请求失败: ${releaseResponse.status} ${releaseResponse.statusText}`,
				),
			)
		}
		if (!tagResponse.ok) {
			return err(
				new Error(
					`GitHub Nightly 标签请求失败: ${tagResponse.status} ${tagResponse.statusText}`,
				),
			)
		}

		const releaseJson: unknown = await releaseResponse.json()
		const tagJson: unknown = await tagResponse.json()
		if (
			typeof releaseJson !== 'object' ||
			releaseJson === null ||
			typeof tagJson !== 'object' ||
			tagJson === null
		) {
			return err(new Error('GitHub 更新信息格式错误'))
		}

		const release = releaseJson as Record<string, unknown>
		const tag = tagJson as Record<string, unknown>
		const tagObject = tag.object
		const buildCommit =
			typeof tagObject === 'object' &&
			tagObject !== null &&
			typeof (tagObject as Record<string, unknown>).sha === 'string'
				? ((tagObject as Record<string, unknown>).sha as string)
				: undefined
		const url = release.html_url
		if (!buildCommit || typeof url !== 'string') {
			return err(new Error('GitHub 更新信息缺少提交或 Release 地址'))
		}

		const assets = parseGitHubReleaseAssets(release.assets)
		const apk = assets.find((asset) =>
			asset.name.toLowerCase().endsWith('.apk'),
		)
		const downloads = apk
			? { android: { 'arm64-v8a': apk.browser_download_url } }
			: undefined
		const shortCommit = buildCommit.slice(0, 7)
		const releaseInfo = {
			buildCommit,
			version: `nightly-${shortCommit}`,
			url,
			notes: typeof release.body === 'string' ? release.body : '',
			downloads,
			forced: false,
		}
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

const parseGitHubReleaseAssets = (value: unknown): GitHubReleaseAsset[] =>
	Array.isArray(value)
		? value.flatMap((item) => {
				if (typeof item !== 'object' || item === null) return []
				const asset = item as Record<string, unknown>
				return typeof asset.name === 'string' &&
					typeof asset.browser_download_url === 'string'
					? [
							{
								name: asset.name,
								browser_download_url: asset.browser_download_url,
							},
						]
					: []
			})
		: []
