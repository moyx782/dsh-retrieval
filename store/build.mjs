/**
 * Rebuild every distributable from `extension/`.
 *
 *   node store/build.mjs
 *
 * Outputs (all relative to the plugin root):
 *   store/upload-chrome.zip            Chrome / Edge 后台上传用（无 Firefox 专有键）
 *   dsh-retrieval-cookie-helper.xpi    Firefox 用（保留 browser_specific_settings）
 *   dsh-retrieval-cookie-helper.zip    源码包，解压后「加载已解压」
 *
 * The manifest is validated here because the stores reject the package, not the
 * upload dialog, when a field is out of bounds.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = join(root, 'extension')

/** Chrome's own limits for the manifest fields it reads. */
const LIMITS = { name: 75, description: 132 }

const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
const problems = []
for (const [field, max] of Object.entries(LIMITS)) {
  const value = String(manifest[field] ?? '')
  if (value === '') problems.push(`${field} is empty`)
  else if (value.length > max) problems.push(`${field} is ${value.length} chars, limit ${max}`)
}
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version))) problems.push(`version "${manifest.version}" is not x.y.z`)
if (problems.length > 0) {
  console.error(`manifest check failed:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

/** Run zip with the given arguments from a directory. */
function zip(cwd, target, entries) {
  rmSync(target, { force: true })
  execFileSync('zip', ['-qr', target, ...entries, '-x', '*.DS_Store'], { cwd })
}

// Chromium package: same files, without the Firefox-only manifest key.
const chromiumDir = join(root, 'store', '.build-chromium')
rmSync(chromiumDir, { recursive: true, force: true })
cpSync(source, chromiumDir, { recursive: true })
const chromiumManifest = { ...manifest }
delete chromiumManifest.browser_specific_settings
writeFileSync(join(chromiumDir, 'manifest.json'), `${JSON.stringify(chromiumManifest, null, 2)}\n`)
zip(chromiumDir, join(root, 'store', 'upload-chrome.zip'), ['.'])

// Firefox package: the untouched source, flat at the archive root.
zip(source, join(root, 'dsh-retrieval-cookie-helper.xpi'), ['.'])

// Source package: one wrapping directory, for "load unpacked" by hand.
const sourceStage = join(root, 'store', '.build-source')
rmSync(sourceStage, { recursive: true, force: true })
mkdirSync(sourceStage, { recursive: true })
cpSync(source, join(sourceStage, 'extension'), { recursive: true })
zip(sourceStage, join(root, 'dsh-retrieval-cookie-helper.zip'), ['extension'])

rmSync(chromiumDir, { recursive: true, force: true })
rmSync(sourceStage, { recursive: true, force: true })

console.log(`version ${manifest.version}`)
console.log(`name ${manifest.name.length}/${LIMITS.name}`)
console.log(`description ${manifest.description.length}/${LIMITS.description}`)
console.log('wrote store/upload-chrome.zip, dsh-retrieval-cookie-helper.xpi, dsh-retrieval-cookie-helper.zip')
