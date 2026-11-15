/**
 * Live smoke run against the real network. Not part of `node --test`: it needs
 * egress and the free tiers' goodwill. Run it by hand after touching a tier.
 */
import { probe, formatProbe } from '../lib/probe.js'
import { retrieve, formatRetrieve } from '../lib/retrieve.js'
import { webSearch } from '../lib/search.js'
import { formatSearch } from '../lib/retrieve.js'
import { readWithService } from '../lib/reader.js'

const CASES = [
  ['static html', 'https://example.com/', 'fetch'],
  ['github repo', 'https://github.com/microsoft/playwright', 'fetch'],
  ['github file', 'https://github.com/cheeriojs/cheerio/blob/main/Readme.md', 'fetch'],
  ['wikipedia', 'https://en.wikipedia.org/wiki/Web_scraping', 'fetch'],
  ['hacker news', 'https://news.ycombinator.com/item?id=1', 'fetch'],
  ['arxiv', 'https://arxiv.org/abs/1706.03762', 'fetch'],
  ['stack overflow', 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array', 'fetch'],
  ['npm', 'https://www.npmjs.com/package/playwright', 'fetch'],
  ['pypi', 'https://pypi.org/project/trafilatura/', 'fetch'],
  ['probe', 'https://example.com/', 'probe'],
]

let failures = 0
for (const [label, url, action] of CASES) {
  const started = Date.now()
  try {
    if (action === 'probe') {
      const report = await probe(url, { timeoutMs: 20_000 })
      console.log(`\n=== ${label} (${Date.now() - started}ms) ===\n${formatProbe(report)}`)
    } else {
      const result = await retrieve(url, { timeoutMs: 20_000 })
      console.log(`\n=== ${label} (${result.ms}ms, tier ${result.layer}, ${result.text.length} chars) ===`)
      console.log(formatRetrieve({ ...result, text: result.text.slice(0, 600) }))
    }
  } catch (error) {
    failures += 1
    console.log(`\n=== ${label} FAILED (${Date.now() - started}ms) ===\n${error.message}`)
  }
}

try {
  const outcome = await webSearch('playwright', { limit: 5, timeoutMs: 16_000 })
  console.log(`\n=== search ===\n${formatSearch('playwright', outcome)}`)
  if (outcome.results.length === 0) failures += 1
} catch (error) {
  failures += 1
  console.log(`\n=== search FAILED ===\n${error.message}`)
}

try {
  const service = await readWithService('https://example.com/', { timeoutMs: 30_000 })
  console.log(`\n=== reader ===\ntitle: ${service.title}\n${service.text.slice(0, 200)}`)
} catch (error) {
  failures += 1
  console.log(`\n=== reader FAILED ===\n${error.message}`)
}

console.log(`\n${failures === 0 ? 'all tiers answered' : `${failures} case(s) failed`}`)
process.exitCode = failures === 0 ? 0 : 1
