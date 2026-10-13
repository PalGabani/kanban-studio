import assert from 'node:assert/strict'
import test from 'node:test'
import { createSecret, hashPassword, hashToken, normalizeEmail, verifyPassword } from '../security.js'

test('password hashing verifies the original password and rejects a different one', async () => {
  const password = 'correct horse battery staple'
  const encoded = await hashPassword(password)

  assert.match(encoded, /^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
  assert.equal(encoded.includes(password), false)
  assert.equal(await verifyPassword(password, encoded), true)
  assert.equal(await verifyPassword('incorrect password', encoded), false)
})

test('password verification rejects malformed encodings', async () => {
  assert.equal(await verifyPassword('password', 'not-a-password-hash'), false)
  assert.equal(await verifyPassword('password', 'scrypt$999999$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128)), false)
})

test('opaque secrets are random and token hashes are deterministic and one-way', () => {
  const first = createSecret()
  const second = createSecret()

  assert.notEqual(first, second)
  assert.equal(hashToken(first), hashToken(first))
  assert.notEqual(hashToken(first), first)
  assert.notEqual(hashToken(first), hashToken(second))
})

test('email addresses are normalized before tenant account lookups', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com')
})
