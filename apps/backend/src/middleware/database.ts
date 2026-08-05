import { createMiddleware } from 'hono/factory'

import { createDb } from '../db'
import type { DrizzleDb } from '../db'

export type DatabaseVariables = {
	db: DrizzleDb
}

/**
 * Creates one database connection for the request and always releases it after
 * the downstream handler finishes, including early responses and thrown errors.
 */
export const databaseMiddleware = createMiddleware<{
	Bindings: Env
	Variables: DatabaseVariables
}>(async (c, next) => {
	const { db, client } = await createDb(c.env.DATABASE_URL)
	c.set('db', db)

	try {
		await next()
	} finally {
		await client.end()
	}
})
