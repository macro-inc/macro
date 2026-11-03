# Channel preview browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/core/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `MARKDOWN_PREVIEW_TEST_PORT` overrides
port 3005; the harness owns and stops its Vite server.

The fixture mounts the production wide/narrow channel row content and Home card
layouts over synthetic data. It blocks hosted API traffic. Desktop, tablet touch,
and phone touch checks verify the browser's native accessibility tree, pointer
activation of the owning row, Tab navigation, and interactive conversation links
and mentions. DOM-derived ARIA snapshots do not model `inert`, so accessibility
assertions use Chromium's native CDP tree. This is component integration coverage,
not authenticated app navigation or a VoiceOver session.

Screenshots from the verified fixture: [desktop](proof/desktop.png) and
[phone](proof/mobile.png).

## Message links

`links.browser.e2e.ts` mounts the production Markdown parser, renderer, composer,
and link menu over the original App Store message. It checks pointer/keyboard
navigation, encoded URLs, Markdown punctuation, literal code, and Remove link →
save → reopen on desktop, tablet touch, and phone touch. Network requests outside
the local fixture are intercepted. Run just this case by adding
`links.browser.e2e.ts` to the command above.

Screenshots: [desktop](proof/autolinks-desktop.png) and
[phone](proof/autolinks-mobile.png).

## User mentions

`user-mentions.browser.e2e.ts` checks ID-only user mentions in the production
renderer and composer, including name lookup success/failure and save/reopen,
on desktop, tablet, and phone.

## Ordered list start

`lists.browser.e2e.ts` types `6.` then Enter in the production channel
composer. The list must start at 6 in the draft and after save.

Screenshot: [desktop](proof/ordered-list-start.png).

## Message quotes

`quotes.browser.e2e.ts` selects three paragraphs backward and applies Quote
through the real floating toolbar on desktop/tablet and the composer format
ribbon on phones. It checks the first paragraph's quote styling and the saved
message. Run just this case by adding `quotes.browser.e2e.ts` to the command above.
It also creates a quote with `> ` and pastes multiple paragraphs from plain text,
HTML, and Lexical clipboards, both into an empty quote and over selected text.
All pasted paragraphs stay quoted, inline formatting and surrounding text survive,
and typing at the paste caret and saving keep the quote formatting.
Replacing adjacent quotes also preserves quoting, while ranges containing
unquoted paragraphs retain normal paste behavior.

Screenshots: [desktop](proof/quotes-desktop.png), [phone](proof/quotes-mobile.png),
and [multi-paragraph paste](proof/quote-paste.png).

## Images in lists

`list-images.browser.e2e.ts` mounts the production Markdown editor with media
and file drop over a numbered list. It inserts an image from an item, from the
empty item Enter leaves (the image joins the item above, and a second Enter
leaves the list), presses Enter after an item with an image, and drops a file on
an item. It checks that the list stays one list with continuous numbering, that
images align with their item's text, and that the saved Markdown indents each
image under its item and renders back as one list, on desktop, tablet touch, and
phone touch. Run just this case by adding `list-images.browser.e2e.ts` to the
command above.
