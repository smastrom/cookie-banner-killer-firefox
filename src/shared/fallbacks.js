// Browser-specific equivalents of upstream filters, active in both modes.
export const SITE_FIXES = `
! Corriere serves Firefox this Piano loader instead of cdn.tinypass.com/api/piano.js.
! The upstream uBlock cookie list already blocks the latter on Corriere.
! Verified 2026-10-28; keep the subscription checkout subdomain unaffected.
||cdn.ith9ueyuhu.it/api/tinypass.min.js$script,domain=corriere.it|~abbonamenti.corriere.it
`

// Local alternatives for upstream rules that require a consent choice.
// Keep these narrowly scoped and verify on the live site before adding one.
export const BLOCK_AND_HIDE_FIXES = `
! The Guardian: hide its Sourcepoint cookie wall without the upstream Accept-all click.
! Verified 2026-10-27 on https://www.theguardian.com/international
theguardian.com##div[id^="sp_message_container_"]
! Corriere's cookie wall is separate from its Piano subscription popup.
! Hide it without running the upstream Accept-and-continue click.
! Verified 2026-10-28 with fresh site data on the supplied technology article.
corriere.it,~abbonamenti.corriere.it##.privacy-cp-wall
`
