import type {
	BilibiliSubtitleData,
	BilibiliSubtitleItem,
} from '@/types/apis/bilibili'

const languageRank = (language: string) => {
	const normalized = language.toLowerCase()
	if (normalized.startsWith('zh')) return 0
	if (normalized.startsWith('ja') || normalized.startsWith('jp')) return 1
	if (normalized.startsWith('en')) return 2
	return 3
}

const subtitleRank = (subtitle: BilibiliSubtitleItem) => {
	const sourceRank = subtitle.type === 0 ? 0 : 100
	const translationRank = subtitle.ai_type === 1 ? 10 : 0
	return sourceRank + translationRank + languageRank(subtitle.lan)
}

/** Prefer uploader/CC subtitles, then AI captions, while retaining API order on ties. */
export const selectBilibiliSubtitle = (
	subtitles: BilibiliSubtitleItem[],
): BilibiliSubtitleItem | undefined => {
	let selected: BilibiliSubtitleItem | undefined
	let selectedRank = Number.POSITIVE_INFINITY

	for (const subtitle of subtitles) {
		if (!subtitle.subtitle_url) continue
		const rank = subtitleRank(subtitle)
		if (rank < selectedRank) {
			selected = subtitle
			selectedRank = rank
		}
	}

	return selected
}

const formatLrcTimestamp = (seconds: number) => {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
	const minutes = Math.floor(totalMilliseconds / 60_000)
	const secondsPart = Math.floor((totalMilliseconds % 60_000) / 1000)
	const milliseconds = totalMilliseconds % 1000

	return `${minutes.toString().padStart(2, '0')}:${secondsPart
		.toString()
		.padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

/** Converts Bilibili's timed subtitle body into the SPL-compatible LRC cache format. */
export const convertBilibiliSubtitleToSpl = (
	data: BilibiliSubtitleData,
): string | undefined => {
	const groupedLines = new Map<number, string[]>()

	for (const item of data.body ?? []) {
		if (!Number.isFinite(item.from) || item.from < 0) continue
		const content = item.content.replace(/\s+/g, ' ').trim()
		if (!content) continue

		const timestampMs = Math.round(item.from * 1000)
		const linesAtTimestamp = groupedLines.get(timestampMs) ?? []
		if (!linesAtTimestamp.includes(content)) {
			linesAtTimestamp.push(content)
			groupedLines.set(timestampMs, linesAtTimestamp)
		}
	}

	if (groupedLines.size === 0) return undefined

	const lines = [...groupedLines.entries()]
		.sort(([left], [right]) => left - right)
		.map(
			([timestampMs, contents]) =>
				`[${formatLrcTimestamp(timestampMs / 1000)}]${contents.join(' / ')}`,
		)

	return ['[by:哔哩哔哩字幕]', ...lines].join('\n')
}
