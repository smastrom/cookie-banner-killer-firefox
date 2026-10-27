# Cookie Banner Killer

A Firefox extension that removes cookie banners using the Ghostery filtering engine and [Brave’s cookie filter sources](https://github.com/brave/adblock-resources/blob/master/filter_lists/list_catalog.json): EasyList Cookie, uBlock Cookie Notices, and Brave’s additions.

## Features

- Blocks matching requests and hides banners, including delayed content, frames, and open shadow roots.
- Restores scrolling after known banners are hidden.
- Includes per-site exceptions, custom filters, daily list updates, and bundled lists for offline use.
- Includes Firefox-specific fixes for Corriere and a hiding rule for the Guardian’s cookie wall.
- Optional paywall support on supported websites.

Consent actions are off by default. Enabling **Allow consent actions** runs additional upstream rules that click buttons or write consent cookies/storage; some accept optional cookies.

Coverage follows Brave’s cookie lists. General ad/tracker blocking, fingerprinting protection, closed shadow roots and protected Firefox pages are outside its scope. Hiding a banner does not guarantee that tracking stops.

## Paywall support

Enable **Paywall support** in the popup or settings; it is off by default and works independently of cookie blocking. Site exceptions pause both features.

Content withheld by the server cannot be restored. If an adapter cannot find the article text, it leaves the subscription prompt intact. The adapters preserve sign-in cookies and show their result in the popup. Publisher changes can break support; fixes ship with extension updates.

## Install

Requires **Firefox 142+**. Packages built here are unsigned.

```sh
bun install --frozen-lockfile
bun run package
```

For a temporary installation, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `dist/manifest.json`. Reload existing website tabs. Firefox removes temporary add-ons when it exits.

For a persistent installation, use **Install Add-on From File…** in `about:addons` with the XPI in `artifacts/`. Regular Firefox requires a [Mozilla-signed package](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). Developer Edition can use unsigned packages when its profile is [configured to allow them](https://extensionworkshop.com/documentation/develop/test-permission-requests/).

## Development

Requires **Bun 1.4.4+**. Dependencies are pinned in `bun.lock`.

```sh
bun fmt
bun test
bun run build
bun run lint
bun run test:firefox
bun run test:paywalls:live
bun run audit:filters --online
bun run package
```

- `bun run update:filters` refreshes bundled lists and records their hashes.
- `bun run audit:filters --online` compares sources with Brave’s current catalog and checks active rules, selectors, scriptlets, and redirects. It does not measure live-site coverage.
- `bun run test:smoke <url> …` compares pages in clean Firefox profiles with and without the extension. Results go to `test-results/`.
- `bun run test:firefox` runs local integration fixtures in an isolated profile. Set `FIREFOX_BINARY` if Firefox Developer Edition is installed elsewhere.
- `bun run test:paywalls:live` compares supported articles with paywall support off/on in isolated profiles; saves measurements and screenshots to `test-results/paywalls/`.

Packaging produces reproducible XPI and source archives in `artifacts/`. Scriptlet and adapter code is bundled. Publisher URLs, scope and test dates live in `src/shared/paywalls.js`.

## Privacy and licenses

No telemetry or accounts. Settings and downloaded filters stay in browser storage. List updates contact `secure.fanboy.co.nz` and `raw.githubusercontent.com` without cookies or browsing URLs; disable daily updates to use only local lists. Website, tab, and request permissions are used to filter pages and manage site exceptions.

Original source: MPL-2.0. Third-party lists and resources retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Include the corresponding source when redistributing packages. This project is independent of Brave, Ghostery, and Mozilla.

Made with AI assistance and distributed as is.
