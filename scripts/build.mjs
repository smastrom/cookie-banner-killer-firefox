import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { LIST_SOURCES } from '../src/shared/config.js'
import { validateList } from '../src/shared/filters.js'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await cp('static', 'dist', { recursive: true })
await cp('filters', 'dist/filters', { recursive: true })
await cp('vendor', 'dist/vendor', { recursive: true })
await cp('LICENSE', 'dist/LICENSE')
await cp('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md')
const manifest = JSON.parse(await readFile('static/manifest.json', 'utf8'))
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions must match.')
for (const source of LIST_SOURCES)
  validateList(await readFile(`filters/${source.file}`, 'utf8'), source)
const builds = await Promise.all(
  [
    { entrypoints: ['src/background.js', 'src/content.js'], outdir: 'dist' },
    { entrypoints: ['src/popup.js', 'src/options.js'], outdir: 'dist/ui' },
  ].map((options) =>
    Bun.build({
      ...options,
      root: 'src',
      naming: '[name].js',
      format: 'iife',
      target: 'browser',
      minify: false,
      sourcemap: 'none',
    })
  )
)
for (const result of builds) {
  if (!result.success) throw new AggregateError(result.logs, 'Extension bundle failed.')
}
await writeFile(
  'dist/build-info.json',
  JSON.stringify({ version: pkg.version, engine: '2.20.1' }, null, 2) + '\n'
)
console.log(`Built Cookie Banner Killer ${pkg.version} with Bun ${Bun.version}.`)
