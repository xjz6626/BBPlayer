import dayjs from 'dayjs'

export const PLAY_HISTORY_HEATMAP_WEEK_STARTS_ON = 0 as const

export type PlayHistoryTimestampRange = {
	startTimeMs: number
	endTimeMs: number
	startTimeSeconds: number
	endTimeSeconds: number
}

export type PlayHistoryHeatmapRange = PlayHistoryTimestampRange & {
	startDate: Date
	endDate: Date
	startDateKey: string
	endDateKey: string
}

export const getPlayHistoryTimestampRange = (
	startTimeMs: number,
	endTimeMs: number,
): PlayHistoryTimestampRange => ({
	startTimeMs,
	endTimeMs,
	startTimeSeconds: Math.floor(startTimeMs / 1000),
	endTimeSeconds: Math.floor(endTimeMs / 1000),
})

/**
 * Keep this range shared by the home query and WeeklyHeatMap. WeeklyHeatMap
 * expands its first date to the start of that week, so the range does the same
 * explicitly to avoid rendering cells that the database query did not load.
 */
export const getPlayHistoryHeatmapRange = (
	now: Date = new Date(),
): PlayHistoryHeatmapRange => {
	const today = dayjs(now).startOf('day')
	const oneYearAgo = today.subtract(1, 'year')
	const startDate = oneYearAgo.subtract(
		oneYearAgo.day() - PLAY_HISTORY_HEATMAP_WEEK_STARTS_ON,
		'day',
	)
	const endTime = today.add(1, 'day')

	return {
		...getPlayHistoryTimestampRange(startDate.valueOf(), endTime.valueOf()),
		startDate: startDate.toDate(),
		endDate: today.toDate(),
		startDateKey: startDate.format('YYYY-MM-DD'),
		endDateKey: today.format('YYYY-MM-DD'),
	}
}
