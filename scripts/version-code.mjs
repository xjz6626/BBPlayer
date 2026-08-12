const VERSION_CODE_EPOCH_MS = Date.UTC(2026, 0, 1)
const MAX_ANDROID_VERSION_CODE = 2_100_000_000

// A hash cannot preserve ordering. Encode UTC time relative to a recent epoch
// so every build gets a compact, monotonically increasing Android versionCode.
const versionCode = Math.floor((Date.now() - VERSION_CODE_EPOCH_MS) / 1000)

if (versionCode <= 0 || versionCode > MAX_ANDROID_VERSION_CODE) {
	throw new RangeError(
		`Generated Android versionCode ${versionCode} is outside 1..${MAX_ANDROID_VERSION_CODE}`,
	)
}

process.stdout.write(String(versionCode))
