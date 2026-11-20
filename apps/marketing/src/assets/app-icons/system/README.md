# Website interface icons

Frozen from `apps/web/src/components/icon/system` at app revision
`9aa2c2a8740a330289373121b93c786640b0d97e`. The adjacent `../share.svg` is copied from the same
revision. These are the app's original Macro drawings, not Phosphor glyphs.

Import individual files through `@icon/system/regular`, `fill`, or `bold`.
Keep SVG geometry, `data-macro-icon`, accessibility attributes, and
`currentColor` intact. `src/styles/site-icons.css` mirrors the app's theme-aware
stroke weights. Brand logos and animated illustrations keep their own assets.

Refresh only icons used by the website from a reviewed app revision, then
verify navigation, entity references, task states, and composer actions at
14/16/20/24 px in both themes. Do not apply old 256-unit stroke overrides
to these 24-unit icons. Keep the website independent of app runtime imports.
