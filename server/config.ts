import { z } from 'zod'

const booleanFromEnv = z.enum(['true', 'false']).default('false').transform((value) => value === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1).default('kanban_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: booleanFromEnv,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('Kanban Studio <no-reply@localhost>'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid server configuration:', z.prettifyError(parsed.error))
  throw new Error('Server configuration is invalid. Check the required environment variables.')
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.SMTP_HOST) {
  throw new Error('SMTP_HOST must be configured in production to deliver tenant invitations.')
}

export const config = parsed.data
