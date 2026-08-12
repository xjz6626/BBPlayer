import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { playlistMembers, sharedPlaylists } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { databaseMiddleware } from '../middleware/database'
import type { DatabaseVariables } from '../middleware/database'
import type { JwtTokenPayload, WorkerBindings } from '../types'

/**
 * GET /api/me/playlists
 * 返回当前用户参与（owner / editor / subscriber）的所有未删除歌单。
 * 用于换设备后的全量恢复入口。
 */
const meRoute = new Hono<{
	Bindings: WorkerBindings
	Variables: { jwtPayload: JwtTokenPayload } & DatabaseVariables
}>()
	.use('*', authMiddleware)
	.use('*', databaseMiddleware)
	.get('/playlists', async (c) => {
		const { sub } = c.var.jwtPayload
		const db = c.var.db

		const rows = await db
			.select({
				id: sharedPlaylists.id,
				title: sharedPlaylists.title,
				description: sharedPlaylists.description,
				coverUrl: sharedPlaylists.coverUrl,
				updatedAt: sharedPlaylists.updatedAt,
				role: playlistMembers.role,
				joinedAt: playlistMembers.joinedAt,
			})
			.from(playlistMembers)
			.innerJoin(
				sharedPlaylists,
				and(
					eq(playlistMembers.playlistId, sharedPlaylists.id),
					isNull(sharedPlaylists.deletedAt),
				),
			)
			.where(eq(playlistMembers.userId, sub))
			.orderBy(desc(playlistMembers.joinedAt))

		return c.json({ playlists: rows })
	})

export default meRoute
