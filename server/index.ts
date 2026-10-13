import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

const server = app.listen(config.API_PORT, '127.0.0.1', () => {
  console.info(`Kanban Studio API listening on http://127.0.0.1:${config.API_PORT}`)
})

async function shutdown(signal: string) {
  console.info(`Received ${signal}; shutting down.`)
  server.close(async (error) => {
    if (error) {
      console.error('HTTP server shutdown failed.', error)
      process.exitCode = 1
    }
    await pool.end()
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
