import type { AuthContext } from './roles.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}
