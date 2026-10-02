# Slack reaction shortcodes

`emoji-shortcodes.json` is generated, not hand-maintained. It maps names without
colons to the same Unicode strings the frontend uses for stored reactions.

From the repository root, with the locked frontend packages installed:

```sh
bun apps/web/scripts/generate-slack-emoji-map.ts
bun apps/web/scripts/generate-slack-emoji-map.ts --check
```

## Pinned provenance

- [emojibase-data](https://github.com/milesj/emojibase/tree/master/packages/data)
  **17.0.0**, MIT: `en/shortcodes/iamcal.json` (Slack-compatible names) and
  `en/shortcodes/github.json` (additional aliases). Slack/iamcal wins collisions,
  including `email`. Includes `+1`/`thumbsup`, `-1`/`thumbsdown`,
  `hankey`/`poop`/`shit`, and `flag-*` names where supplied upstream.
- [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) **0.8.0**,
  MIT: `data-ordered-emoji.json`, for canonical output matching
  `apps/web/src/lib/core/component/Emoji/emojis.ts`. Join keys ignore FE0F;
  output strings are copied intact, not normalized independently in Rust.
- Exact package integrity hashes are recorded in the root `bun.lock`. The
  generator rejects version drift; review this file and regression tests on bumps.

Entries absent from the frontend's canonical emoji set and skin-tone variants
are omitted. The Rust converter strips Slack `::skin-tone-2` through
`::skin-tone-6` suffixes before lookup, including paired-tone suffixes. Unknown
and workspace-custom shortcodes are dropped from reactions, not fetched from
Slack. Message text shortcodes stay literal; this table is for reactions only.
The JSON uses ASCII escapes and sorted keys for deterministic review.

## Licenses

Both inputs are distributed under the following MIT permission grant. Retain
both copyright notices with the generated data:

Copyright (c) 2017-2019 Miles Johnson (emojibase-data)

Copyright (c) 2019 Mu-An Chiou (unicode-emoji-json)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
