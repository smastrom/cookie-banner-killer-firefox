import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { LIST_SOURCES } from '../src/shared/config.js'
import { downloadLists } from '../src/shared/filters.js'

const texts = await downloadLists()
await mkdir('filters', { recursive: true })
for (const source of LIST_SOURCES) await writeFile(`filters/${source.file}`, texts[source.id])
const metadata = {
  downloadedAt: new Date().toISOString(),
  sources: LIST_SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    sha256: createHash('sha256').update(texts[source.id]).digest('hex'),
  })),
}
await writeFile('filters/metadata.json', JSON.stringify(metadata, null, 2) + '\n')
console.log(`Updated ${LIST_SOURCES.length} bundled filter files.`)
