# Third-party components

This independent extension is not affiliated with Brave, Ghostery, Mozilla, or the filter-list authors.

- **Ghostery Adblocker 2.20.1**, copyright Ghostery GmbH and contributors. Filtering engine, DOM monitoring, selector evaluation and script injection helpers. [Source](https://github.com/ghostery/adblocker/tree/v2.20.1), MPL-2.0; full license in `vendor/licenses/Ghostery-MPL-2.0.txt`.
- **EasyList Cookie**, by the EasyList authors (Fanboy, MonztA, Khrin, Yuki2718 and contributors). [Project](https://github.com/easylist/easylist), distributed under the [Creative Commons Attribution 3.0 license](https://creativecommons.org/licenses/by/3.0/). Original downloaded lists and attribution headers are preserved in `filters/`. Rules are conditionally selected at runtime; lists are not represented as original work.
- **uBlock Origin Cookie Notices**, copyright Raymond Hill and contributors. [Source](https://github.com/uBlockOrigin/uAssets), GPL-3.0; full license in `vendor/licenses/uAssets-GPL-3.0.txt`. Original list is included in `filters/ublock-cookies.txt`.
- **Brave cookie additions**, copyright Brave Software and contributors. [Source](https://github.com/brave/adblock-lists), MPL-2.0; full license in `vendor/licenses/brave-MPL-2.0.txt`.
- **uBlock Origin scriptlets and redirect resources**, copyright Raymond Hill and contributors, GPL-3.0. Vendored in `vendor/resources.json` from the [Ghostery 2.20.1 release](https://github.com/ghostery/adblocker/blob/v2.20.1/packages/adblocker/assets/ublock-origin/resources.json). The upstream source is [uBlock Origin](https://github.com/gorhill/uBlock), especially `src/js/resources/` and `src/web_accessible_resources/`. This file is bundled with the extension and is never fetched or replaced by automatic list updates.
- **tldts / tldts-experimental**, copyright Rémi Berson and contributors, MIT. Bundled transitively by the Ghostery engine; license in `vendor/licenses/tldts-MIT.txt`. [Source](https://github.com/remusao/tldts).

Original extension source files are MPL-2.0. Third-party files retain their licenses, including GPL-3.0 requirements for the uBlock resources. Distribute the complete source alongside derived packages. This project makes no endorsement claim.
