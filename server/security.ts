import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
const passwordCost = 32_768
const passwordBlockSize = 8
const passwordParallelism = 1
const keyLength = 64
const scryptOptions = { N: passwordCost, r: passwordBlockSize, p: passwordParallelism, maxmem: 128 * 1024 * 1024 }

function scryptAsync(password: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, scryptOptions, (error, derived) => {
      if (error) {
        reject(error)
        return
      }
      resolve(Buffer.from(derived))
    })
  })
}

export function createSecret() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, keyLength)
  return `scrypt$${passwordCost}$${passwordBlockSize}$${passwordParallelism}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, blockSize, parallelism, saltHex, expectedHex] = encoded.split('$')
  if (
    algorithm !== 'scrypt' ||
    cost !== String(passwordCost) ||
    blockSize !== String(passwordBlockSize) ||
    parallelism !== String(passwordParallelism) ||
    !/^[0-9a-f]{32}$/i.test(saltHex ?? '') ||
    !/^[0-9a-f]{128}$/i.test(expectedHex ?? '')
  ) {
    return false
  }
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}
