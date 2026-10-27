export const articleText = [
  'This is an original synthetic article used to check that the extension restores the correct story. '.repeat(
    8
  ),
  'A second paragraph checks that the rest of the story becomes readable without changing the sign-in interface. '.repeat(
    8
  ),
].join('\n\n')
export const previewText = articleText.slice(0, 500)

export function paywallFixture(url, kind) {
  const variant = new URL(url).searchParams.get('variant')
  const otherArticle = new URL(url)
  otherArticle.pathname += '-other'
  const body =
    articleText + (variant === 'payload' ? '\n<img src=x onerror="window.injected=true">' : '')
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: { '@id': variant === 'wrong-article' ? otherArticle.href : url },
    articleBody: body,
  }).replaceAll('<', '\\u003c')
  const script =
    variant === 'missing'
      ? ''
      : `<script type="application/ld+json">${variant === 'malformed' ? '{invalid JSON' : schema}</script>`
  return `<!doctype html><html><head><title>Publisher article fixture</title><style>
    body{font-family:system-ui;margin:30px}.article-faded{max-height:150px;overflow:hidden}
    .article-faded::after{content:'';position:absolute;inset:0;pointer-events:none}
    .paywall-wrapper__story-content{height:0;overflow:hidden}.paywallbox,.paywall{padding:24px;background:#eee}
    dialog:not([open]){display:none}
  </style></head><body><article>
    ${
      kind === 'domani'
        ? `<div class="article-preview article-faded"><p>${previewText}</p></div><div class="paywallbox">Subscribe</div>${script}`
        : `<div class="paywall-wrapper"><div class="paywall-wrapper__story-content qiota_hidden_trunked" style="height:0!important;overflow:hidden!important"><div>${variant === 'missing' ? 'Only a short preview.' : articleText}</div></div><div class="paywall">Subscribe</div></div>`
    }
    <button id="account-button">Sign in</button></article>
    <dialog id="account-dialog" aria-modal="true">Account sign-in</dialog>
    <div id="unrelated" class="paywall">An unrelated panel</div>
    <div id="cookie-banner">Cookie notice</div>
  </body></html>`
}
