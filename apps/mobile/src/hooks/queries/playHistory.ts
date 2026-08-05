import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { and, count, desc, gte, lt, or, sql } from 'drizzle-orm'

import drizzleDb from '@/lib/db/db'
import * as schema from '@/lib/db/schema'
import { trackService } from '@/lib/services/trackService'
import type { Track } from '@/types/core/media'
import {
	getPlayHistoryTimestampRange,
	type PlayHistoryHeatmapRange,
} from '@/utils/playHistoryDateRange'

export const playHistoryKeys = {
	all: ['playHistory'] as const,
	heatmap: (range: PlayHistoryHeatmapRange) =>
		[
			...playHistoryKeys.all,
			'heatmap',
			range.startDateKey,
			range.endDateKey,
			range.startTimeMs,
			range.endTimeMs,
			range.startTimeSeconds,
			range.endTimeSeconds,
		] as const,
	byDate: (date: string) => [...playHistoryKeys.all, 'byDate', date] as const,
	topPlayed: (days: number, limit: number) =>
		[...playHistoryKeys.all, 'topPlayed', days, limit] as const,
}

export const usePlayHistoryHeatmap = (range: PlayHistoryHeatmapRange) => {
	return useQuery({
		queryKey: playHistoryKeys.heatmap(range),
		queryFn: async () => {
			const localDate = sql<string>`date(
				CASE
					WHEN ${schema.playHistory.startTime} > 10000000000
						THEN ${schema.playHistory.startTime} / 1000
					ELSE ${schema.playHistory.startTime}
				END,
				'unixepoch',
				'localtime'
			)`
			const result = await drizzleDb
				.select({
					date: localDate,
					count: count(),
				})
				.from(schema.playHistory)
				.where(
					or(
						and(
							gte(schema.playHistory.startTime, range.startTimeMs),
							lt(schema.playHistory.startTime, range.endTimeMs),
						),
						and(
							gte(schema.playHistory.startTime, range.startTimeSeconds),
							lt(schema.playHistory.startTime, range.endTimeSeconds),
						),
					),
				)
				.groupBy(localDate)

			const data: Record<string, number> = {}
			result.forEach((row) => {
				if (row.date) {
					data[row.date] = row.count
				}
			})
			return data
		},
		networkMode: 'always',
		staleTime: 0,
	})
}

export const usePlayHistoryByDate = (dateStr: string) => {
	return useQuery({
		queryKey: playHistoryKeys.byDate(dateStr),
		queryFn: async () => {
			const date = dayjs(dateStr)
			const startTimeMs = date.startOf('day').valueOf()
			const endTimeMs = date.add(1, 'day').startOf('day').valueOf()
			const range = getPlayHistoryTimestampRange(startTimeMs, endTimeMs)

			const historyRows = await drizzleDb.query.playHistory.findMany({
				where: (ph, { and, gte, lt, or }) =>
					or(
						and(
							gte(ph.startTime, range.startTimeMs),
							lt(ph.startTime, range.endTimeMs),
						),
						and(
							gte(ph.startTime, range.startTimeSeconds),
							lt(ph.startTime, range.endTimeSeconds),
						),
					),
				with: {
					track: {
						with: {
							artist: true,
							bilibiliMetadata: true,
							localMetadata: true,
						},
					},
				},
				orderBy: [desc(schema.playHistory.startTime)],
			})

			// 过滤掉没有 track 的异常数据，并转换类型
			return historyRows
				.filter((row) => row.track !== null && row.track !== undefined)
				.map((row) => {
					const track = row.track as unknown as Track
					return {
						...track,
						historyId: row.id,
						playedAt: row.startTime,
						durationPlayed: row.durationPlayed,
						completed: row.completed,
					}
				})
		},
		enabled: !!dateStr && dayjs(dateStr).isValid(),
		networkMode: 'always',
		staleTime: 0,
	})
}

export const useMostPlayedTracks = (days: number, limit: number) => {
	return useQuery({
		queryKey: playHistoryKeys.topPlayed(days, limit),
		queryFn: async () => {
			const result = await trackService.getMostPlayedTracksInLastDays({
				days,
				limit,
			})
			if (result.isErr()) {
				throw result.error
			}
			return result.value
		},
		enabled: true,
		networkMode: 'always',
		staleTime: 60 * 1000,
	})
}
