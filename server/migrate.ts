import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url))

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [84021967])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const appliedNames = new Set(applied.rows.map((row) => row.name))
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort()

    for (const name of migrationFiles) {
      if (appliedNames.has(name)) continue
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        console.info(`Applied migration ${name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    console.info('Database schema is up to date.')
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [84021967])
    } finally {
      client.release()
      await pool.end()
    }
  }
}

migrate().catch((error: unknown) => {
  console.error('Database migration failed.', error)
  process.exitCode = 1
})
