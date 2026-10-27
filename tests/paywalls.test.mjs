import { test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  articleBodyFromJSON,
  longerArticle,
  paywallPublisher,
  PAYWALL_PUBLISHERS,
} from '../src/shared/paywalls.js'
import { validateSettings } from '../src/shared/config.js'

test('paywall adapters match article paths, excluding accounts, other subdomains and lookalike hosts', () => {
  for (const publisher of PAYWALL_PUBLISHERS) {
    assert.equal(paywallPublisher(publisher.testURL)?.id, publisher.id)
    const url = new URL(publisher.testURL)
    for (const path of ['/', '/login', '/abbonamenti', '/account', '/checkout']) {
      assert.equal(paywallPublisher(`${url.origin}${path}`), null)
    }
    assert.equal(
      paywallPublisher(publisher.testURL.replace(url.hostname, `${url.hostname}.example.com`)),
      null
    )
    assert.equal(paywallPublisher(publisher.testURL.replace('www.', 'abbonamenti.')), null)
    assert.equal(paywallPublisher(publisher.testURL.replace('https:', 'ftp:')), null)
  }
  assert.equal(paywallPublisher('not a URL'), null)
  assert.equal(
    paywallPublisher('https://www.editorialedomani.it/fatti/test-article-abcdefgh')?.id,
    'domani'
  )
  assert.equal(validateSettings({}).paywallSupport, false)
  assert.throws(() => validateSettings({ paywallSupport: 'yes' }))
})

test('JSON-LD recovery selects the current article in arrays and graphs', () => {
  const url = PAYWALL_PUBLISHERS[0].testURL
  const current = {
    '@type': 'NewsArticle',
    mainEntityOfPage: { '@id': url },
    articleBody: 'The current article',
  }
  const unrelated = {
    ...current,
    mainEntityOfPage: { '@id': `${url}-other` },
    articleBody: 'A different article',
  }
  assert.equal(
    articleBodyFromJSON(
      JSON.stringify({ '@graph': [unrelated, current] }),
      `${url}?utm_source=test`
    ),
    'The current article'
  )
  assert.equal(
    articleBodyFromJSON(JSON.stringify([unrelated, current]), url),
    'The current article'
  )
  assert.equal(
    articleBodyFromJSON(JSON.stringify({ mainEntity: current }), url),
    'The current article'
  )
  assert.equal(articleBodyFromJSON(JSON.stringify(unrelated), url), '')
  assert.equal(
    articleBodyFromJSON(JSON.stringify({ ...current, mainEntityOfPage: undefined }), url),
    ''
  )
  assert.equal(articleBodyFromJSON(JSON.stringify({ ...current, '@type': 'Product' }), url), '')
  for (const input of ['{bad json', 'null', '[]', 'a'.repeat(2 * 1024 * 1024 + 1)])
    assert.equal(articleBodyFromJSON(input, url), '')
})

test('a preview is replaced only by longer text from the same article', () => {
  const preview =
    'This is a synthetic article preview, repeated for a sufficiently long comparison. '.repeat(4)
  assert.equal(longerArticle(`${preview}\n${'More article text. '.repeat(30)}`, preview), true)
  assert.equal(longerArticle(preview, preview), false)
  assert.equal(longerArticle('Another article. '.repeat(40), preview), false)
  assert.equal(longerArticle('Long article. '.repeat(40), ''), false)
})
