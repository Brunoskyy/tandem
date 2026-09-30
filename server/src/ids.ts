import { randomBytes } from 'node:crypto'

/** 12 bytes of randomness, url-safe. Enough that a board link is not guessable. */
export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url')
}
