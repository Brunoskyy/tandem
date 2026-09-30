import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'

import { LIMITS, parseId } from '@tandem/shared'

import { toMarkdown } from './export.ts'
import type { Rooms } from './rooms.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

export interface HttpOptions {
  rooms: Rooms
  /** Built client to serve; when absent only the API is served (dev, with Vite in front). */
  staticDir?: string | undefined
}

export function createRequestHandler({ rooms, staticDir }: HttpOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true })

      if (url.pathname === '/api/boards' && req.method === 'POST') {
        const body = (await readJson(req)) as { title?: unknown; template?: unknown }
        const title =
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim().slice(0, LIMITS.title)
            : 'Untitled board'
        const template = typeof body.template === 'string' ? body.template : 'retro'
        const state = rooms.create(title, template)
        return json(res, 201, { id: state.id })
      }

      const boardMatch = /^\/api\/boards\/([^/]+)(\/export)?$/.exec(url.pathname)
      if (boardMatch && req.method === 'GET') {
        let id: string
        try {
          id = parseId(boardMatch[1])
        } catch {
          return json(res, 404, { error: 'not found' })
        }
        const state = rooms.peek(id)
        if (!state) return json(res, 404, { error: 'not found' })
        if (boardMatch[2]) {
          if (state.phase === 'write') {
            return json(res, 409, {
              error: 'The board is still in the writing phase. Reveal it first.',
            })
          }
          const body = toMarkdown(state)
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="${safeFilename(state.title)}.md"`,
          })
          res.end(body)
          return
        }
        return json(res, 200, { id: state.id, title: state.title, phase: state.phase })
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })

      if (staticDir) return serveStatic(res, staticDir, url.pathname)
      return json(res, 404, { error: 'not found' })
    } catch (e) {
      if (res.headersSent) res.destroy()
      else json(res, 500, { error: e instanceof Error ? e.message : 'error' })
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 16_384) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function safeFilename(title: string): string {
  return (
    title
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'board'
  )
}

/** Static files with SPA fallback: anything unknown gets index.html and the client routes it. */
function serveStatic(res: ServerResponse, dir: string, pathname: string): void {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(dir, clean)
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
    file = join(dir, 'index.html')
  const ext = extname(file)
  const immutable = /\/assets\//.test(file)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}
