# README image assets

## Header

`logo.png` centers the supplied Frame 10 full lockup above a compact native
README title. The white logo is downscaled to 480 pixels wide on a dark backing;
the 512×70 asset displays at 256×35. A regular-weight paragraph avoids heading margins
and GitHub’s horizontal divider.

`header.png` is a fresh 2400×1350 desktop workspace capture. The conversation
starts below its pane title, with its completed linked code changes alongside.
The full navigation rail, pane headers, and bottom composer remain intact.
Only the native tab strip is excluded; ordinary split close controls remain
inside the workspace rather than cutting away the headers to hide them.
One subtle outer border and 32-pixel corner radius frame the complete surface.
Keep the logo first, regular-weight title second, product third.

## Feature screenshots

The nine images in `framed/` use fixed 16:9 frames and the existing grayscale
Monterey background, 60-pixel inset, 32-pixel corner radius, and one-pixel border.
All nine frames use the same treatment, including replacement captures.
Content stops at the viewport edge rather than using a
different content-dependent aspect ratio for every image. Product pixels are
never stretched, rewritten, or generated.

- Email: recent Signal inbox overview, not the experimental Focus view or a
  third-party invitation. Login-code and address previews are outside the capture.
- Chat: the November 4 feature-request conversation, distinct from the header.
- Tasks: restored original split capture with mixed statuses, assigned work, and
  a completed task with its linked discussion and code change.
- Docs, Agents, Calendar: existing captures reframed consistently.
- Databases: full original Donations Example capture, preserving all columns.
- CRM: fresh desktop board capture at 90% app zoom, showing active deal stages,
  owners, and revenue. Board layout replaces the uneven table rows. No records
  were edited; neighboring columns stop naturally at the viewport edge.
- Calls: An internal group recording, paused near 0:35. People are on
  camera without a screen share. Portrait video and black bars are inherent in
  the recording; the transcript was scrolled independently.

All feature exports are 2400×1350. Original captures and editable local builds
are retained in the November 5 screenshot packages outside the repository.

Preserve the supplied logo proportions, never upscale its raster, and check the
transparent header against light and dark backgrounds. Keep image alt text and
this asset guide in sync with replacements. Do not paint over real product text
or fabricate people, messages, statuses, or results.

Keep navigation when it adds context. Exclude system chrome, pointer highlights,
and tooltips. Inspect all visible content before staging. Exclude credentials
and private personal information; use real business records only when the user
has authorized them for the screenshot. Prefer populated demo data otherwise.

The marketing homepage screenshot copies under
`apps/marketing/src/app/assets/desktop-feature-screens` are independent.

## Star history

`star-history.py` embeds a GitHub stargazer timestamp snapshot through
November 4, 2026 (6,144 stars). It counts current stargazers, so removed stars
are absent from the historical totals.

Refresh the source timestamps with:

```sh
gh api --paginate -H 'Accept: application/vnd.github.star+json' \
  'repos/macro-inc/macro/stargazers?per_page=100' --jq '.[].starred_at'
```

Update `SERIES`, its snapshot comment, the axis bounds and month labels as
needed, and the root README's image description. From the repository root,
run `python3 .github/readme/star-history.py` to regenerate both SVG themes.
