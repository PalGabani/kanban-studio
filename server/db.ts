import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'kanban-studio-api',
  ...(config.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : {}),
})

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL client error.', error)
})
