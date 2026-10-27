import JSZip from 'jszip'

const { version } = await Bun.file('package.json').json()
const date = new Date('1980-01-01T00:00:00Z')
const zipOptions = {
  type: 'uint8array',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
}

async function addDirectory(zip, directory, prefix = '') {
  const paths = [...new Bun.Glob('**/*').scanSync({ cwd: directory, onlyFiles: true })].sort()
  for (const path of paths) {
    zip.file(`${prefix}${path}`, await Bun.file(`${directory}/${path}`).arrayBuffer(), {
      date,
      createFolders: false,
    })
  }
}

const extension = new JSZip()
await addDirectory(extension, 'dist')
const bytes = await extension.generateAsync(zipOptions)
await Bun.write(`artifacts/cookie-banner-killer-${version}-unsigned.xpi`, bytes)
await Bun.write(`artifacts/cookie_banner_killer-${version}.zip`, bytes)

const source = new JSZip()
for (const directory of ['src', 'static', 'scripts', 'tests', 'filters', 'vendor']) {
  await addDirectory(source, directory, `${directory}/`)
}
for (const file of [
  'package.json',
  'bun.lock',
  'bunfig.toml',
  '.prettierignore',
  '.gitignore',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
]) {
  source.file(file, await Bun.file(file).arrayBuffer(), { date, createFolders: false })
}
await Bun.write(
  `artifacts/cookie-banner-killer-${version}-source.zip`,
  await source.generateAsync(zipOptions)
)
console.log(`Created reproducible unsigned XPI and source archives in artifacts/.`)
