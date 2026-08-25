# Signature Editor: paste a hyperlink onto selected text

## Problem Statement

In the Signature Editor, I can type a word, select it, and paste a URL. I expect those words to stay and become a hyperlink. Instead the editor deletes the words and leaves only the URL.

## Solution

When I have text selected in the Signature Editor and I paste exactly one `http://` or `https://` URL, keep my words and apply that URL as the hyperlink. If nothing is selected, or the clipboard is not exactly one protocol URL, paste the way it does today.

## User Stories

1. As a person editing a signature, I want to select a name and paste a company URL, so that the name stays visible and opens that URL.
2. As a person editing a signature, I want to select a call-to-action like "Book a call with me" and paste a booking URL, so that the phrase stays and becomes the hyperlink.
3. As a person editing a signature, I want pasting a URL from the browser address bar to count even when it has a trailing newline, so that a normal copy still wraps.
4. As a person editing a signature, I want leading or trailing spaces on a copied URL to be ignored, so that a sloppy copy still wraps.
5. As a person editing a signature, I want an `http://` URL to wrap the same way as `https://`, so that older links still work.
6. As a person editing a signature, I want an already-hyperlinked phrase to keep its words when I paste a new URL, so that I can retarget "Lunch Flow" without retyping it.
7. As a person editing a signature, I want a collapsed cursor (no selection) to insert the URL as text when I paste, so that "put this URL here" still works.
8. As a person editing a signature, I want pasting `Faith.tools` (no scheme) to keep today's replace behavior, so that we do not invent a new matcher in this change.
9. As a person editing a signature, I want pasting `example.com` to keep today's replace behavior, so that a bare host is not treated as a hyperlink destination.
10. As a person editing a signature, I want pasting `https://example.com extra words` to keep today's replace behavior, so that mixed clipboard text is not silently turned into a hyperlink.
11. As a person editing a signature, I want pasting a relative path like `/pricing` to keep today's replace behavior, so that it does not become a hyperlink on the selection.
12. As a person editing a signature, I want pasting `mailto:` or `tel:` onto a selection to keep today's replace behavior, so that only web URLs wrap in this change.
13. As a person editing a signature, I want pasting `javascript:` or another non-http scheme onto a selection to keep today's replace behavior, so that we do not create a dangerous href.
14. As a person editing a signature, I want pasting a URL that includes a path, query, or fragment (`https://example.com/a?b=1#c`) to wrap, so that real marketing and booking links work.
15. As a person editing a signature, I want pasting ordinary words or a sentence onto a selection to keep today's replace behavior, so that normal edit-by-paste is unchanged.
16. As a person editing a signature, I want pasting formatted HTML that is not a single protocol URL in plain text to keep today's replace behavior, so that rich paste from another editor still replaces.
17. As a person editing a signature, I want the wrap rule to read the clipboard's plain text, so that "Copy link address" and address-bar copy behave the same even when HTML is also present.
18. As a person editing a signature, I want pasting an image onto a selection to keep today's image upload path, so that this change does not break signature images.
19. As a person editing a signature, I want a multi-word selection on one line to stay intact when I paste a URL, so that a phrase can be one hyperlink.
20. As a person editing a signature, I want a selection that spans bold or italic runs to stay intact when I paste a URL, so that formatting is not stripped just to add a hyperlink.
21. As a person editing a signature, I want a selection that spans more than one line to become one hyperlink when I paste a URL, so that a short stacked phrase can share a destination.
22. As a person editing a signature, I want a partial-word selection to hyperlink only the selected characters, so that I am not forced to take the whole word.
23. As a person editing a signature, I want Select All plus a pasted URL to hyperlink the whole signature text, so that the same rule applies at any selection size.
24. As a person editing a signature, I want the Link toolbar control to keep working as it does today, so that I can still type a destination without pasting.
25. As a person editing a signature, I want Clear formatting to still remove a hyperlink I just applied by paste, so that I can undo the look without guessing.
26. As a person editing a signature, I want undo after a wrap-paste to restore the previous selection state, so that a mistaken paste is recoverable.
27. As a person editing a signature, I want the draft to mark dirty after a wrap-paste, so that Save stays available.
28. As a person editing a signature, I want Save to persist the hyperlink in the stored signature HTML, so that compose and sent mail see it.
29. As a person sending mail from that inbox, I want the saved signature to show the original words as the clickable hyperlink, so that recipients do not see a raw URL unless I pasted with no selection.
30. As a person with more than one inbox, I want each Signature Editor to follow this rule on its own, so that wrapping in one inbox does not depend on another.
31. As a person on a setup where email signatures are disabled, I want this behavior to be irrelevant because the editor is not shown, so that we do not special-case the flag beyond existing UI.
32. As a reviewer, I want compose and other rich-text surfaces left alone, so that this change stays on the reported Signature Editor nit.

## Implementation Decisions

- Change only the Signature Editor. Compose already wraps a protocol URL onto a selection in its own editor. Do not share that machinery.
- Add one decision function: given clipboard plain text and whether a range is selected, return the href to apply or nothing. The editor calls that function on paste. If it returns an href, apply the hyperlink to the selection and do not insert the URL as text. If it returns nothing, leave the existing paste path alone (text, HTML, and images).
- Treat the clipboard as a wrap candidate only when, after trim, the entire plain-text string is one `http://` or `https://` URL. Do not use "starts with a URL." Do not add a scheme to bare hosts.
- Scheme matching is case-insensitive (`HTTPS://` counts).
- When the selection already has a hyperlink, apply the new href and keep the words.
- When the selection is collapsed, always take the existing paste path.
- Read `text/plain` for the decision. Do not require HTML to be absent.
- No API, schema, or sanitizer changes. Stored signature HTML already allows `http` and `https` hrefs.
- No new toolbar UI.

## Testing Decisions

A good test checks what the user can observe: wrap vs replace, which href is applied, and that non-matching clipboards are left to the existing paste path. It does not inspect editor internals, event registration, or DOM structure beyond the resulting text and href.

**Seam (one):** the decision function described above. That is the public interface for this change. Existing compose auto-link tests are prior art for testing a URL matcher as a pure function. Prefer that style here. Do not add a browser or Quill-mount test unless the decision function cannot express the case.

Cases at that seam:

- Selected + trimmed `https://` URL → apply that href
- Selected + trimmed `http://` URL → apply that href
- Selected + URL with trailing newline or spaces → apply the trimmed href
- Selected + URL with path, query, or fragment → apply that href
- Selected + `HTTPS://` URL → apply that href
- Selected + bare host, relative path, `mailto:`, mixed text, empty string → apply nothing
- Collapsed + any clipboard → apply nothing

The already-hyperlinked, multi-line, formatting, image, Save, and undo stories are covered by the existing editor once the function returns an href. Do not re-test the editor for those unless a later bug shows the wiring is wrong.

## Out of Scope

- Prefixing `https://` onto bare hosts such as `Faith.tools`
- As-you-type auto-link, including expanding the common-TLD list
- Compose, reply, or any editor other than the Signature Editor
- Changing the Link toolbar prompt
- `mailto:`, `tel:`, `sms:`, or other non-http schemes
- Opening signature hyperlinks in a new tab
- Backend sanitizer or signature storage changes

## Further Notes

"Link" in this product already means an inbox connection. This spec is about a **hyperlink**: an `http` or `https` href on signature text.

The reported nit is wrap-on-paste. The missing-scheme path is a different bug and is deliberately not in this spec.
