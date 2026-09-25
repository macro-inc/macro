# Standalone website verification — September 25, 2026

The public website now owns its presentation components, fixtures, styles,
fonts, icons, and build configuration under `apps/web/marketing`. It imports no
application source or Macro workspace packages. The PR contains no changes to
`apps/web/src`, backend crates, or shared application packages relative to its
merge base. Root workspace registration and public build scripts remain.

The earlier authenticated onboarding work is preserved locally on
`codex/onboarding-before-website-isolation` at
`70f4f570f0b2e1e74e30a6040f853d94cafb7dc6`. It is outside this website change.
Public signup introduction and local previews remain on `/start`; authenticated
account creation continues in the existing app.

## Isolation and loading

- Email, spreadsheet, agent session, pull request, sidebar, and document demos
  use website-owned components with local data. No application providers,
  Lexical bundle, spreadsheet WASM, or compiled application iframe are loaded.
- The build rejects application and workspace imports, including type-only and
  dynamic imports, CSS content scans, escaping assets, and symlinks. Its boundary
  tests cover 24 regression cases.
- Solid SSR and hydration preserve the first-painted homepage headline. The
  build verifies the same node and geometry before and after hydration on
  desktop and mobile, then exercises navigation and the lazy email demo.
- Hydration downloads yield network priority to CSS and fonts. PostHog loads
  after paint with queued events, identity, and landing attribution.
- Initial homepage JavaScript: 345,442 → 192,470 bytes gzip (44% smaller).
  The regression budget is now 225,000 bytes gzip.
- Primary stylesheet: 69,727 → 29,049 bytes gzip (58% smaller).
  The full static artifact shrank from 191 MB to 102 MB.

## Validation

- 99 tests in 16 files pass, including local demo interactions, public onboarding,
  analytics queue behavior, and architecture boundary tests.
- Website TypeScript, production build, standalone gate, `just check`, and
  `git diff --check` pass.
- 31 prerendered pages; all 30 baseline live URLs preserved; 626 internal links
  and 697 local assets verified; metadata, structured data, sitemap, robots,
  and signup noindex checked.
- Browser comparisons against a saved pre-isolation production artifact covered
  the hero, email composer, spreadsheet, document editor, agent card, and trace.
  Local editing, undo, demo expansion, navigation, and public onboarding were
  exercised. Advanced demo actions remain simulated.

## Mobile performance

Lighthouse 13.5.0 / Chromium 147, cold local production builds served with gzip.
Analytics remain enabled. These are lab measurements, not field Core Web Vitals.

| Metric | Saved baseline | Final standalone website |
| --- | ---: | ---: |
| LCP, actual slow 4G / 4× CPU | 3.339 s | 1.919 s |
| FCP, actual slow 4G / 4× CPU | 3.339 s | 1.919 s |
| Total blocking time, same run | 592 ms | 369 ms |
| CLS, same run | 0.0029 | 0.0029 |
| LCP, default simulated mobile | 4.5 s | 3.408 s |
| FCP, default simulated mobile | 4.2 s | 1.507 s |
| Total blocking time, simulated | 380 ms | 155 ms |

Final performance score is 89 in both throttling modes. Accessibility and SEO
score 100. Simulated CLS is zero. Both final runs have no Lighthouse warnings.
The actual-throttling pair is a matched before/after comparison; the simulated
baseline is the earlier launch audit. Repeat on the deployed website origin.

## Deployment follow-through

The website is not deployed by this verification. Publish `apps/web/dist-site`
through the public website deployment, preserve `/app/*` and existing edge
routes, then run `verify-seo-live.ts` against that candidate. The existing app
preview deployment does not automatically publish the website artifact.

CI must also recalculate both platform dependency hashes for the new workspace.
This machine has no Nix installation; prior CI hash values predate these package
changes. Production analytics delivery, CDN caching/redirects, and physical
mobile browser checks remain deployment verification, not claims of this audit.

Reports and screenshots are retained in this session under
`/tmp/macro-standalone-*`; the matched baseline is under
`/tmp/macro-standalone-before/`.
