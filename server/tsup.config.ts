import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // The shared workspace is TypeScript source; bundle it in.
  noExternal: ['@tandem/shared'],
  sourcemap: true,
  clean: true,
})
