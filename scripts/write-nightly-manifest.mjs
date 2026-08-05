import { writeFileSync } from 'node:fs'

const requireEnv = (name) => {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

const repository = requireEnv('GITHUB_REPOSITORY')
const serverUrl = requireEnv('GITHUB_SERVER_URL')
const tag = requireEnv('NIGHTLY_TAG')
const commit = requireEnv('COMMIT_SHA')
const shortCommit = requireEnv('SHORT_SHA')
const apkName = requireEnv('APK_NAME')
const outputPath = requireEnv('UPDATE_MANIFEST_PATH')
const notes = requireEnv('RELEASE_NOTES')

const releaseBaseUrl = `${serverUrl}/${repository}/releases`
const manifest = {
	buildCommit: commit,
	version: `nightly-${shortCommit}`,
	notes,
	url: `${releaseBaseUrl}/tag/${tag}`,
	downloads: {
		android: {
			'arm64-v8a': `${releaseBaseUrl}/download/${tag}/${apkName}.apk`,
		},
	},
	forced: false,
}

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
