# Launch notes: a workspace that reads well

This is a **static Markdown document** inside an inverted section. It combines *emphasis*, **bold text**, ~~superseded decisions~~, and `inline code` in the same paragraph. The surrounding controls and this document should share one readable palette.

## 1. Release overview

> **Design principle:** content should remain readable wherever it is placed.
> A quote can include *emphasis*, a [reference link](https://example.com), and `semantic tokens` without losing its hierarchy.

### Acceptance checklist

- [x] Headings and paragraphs retain clear contrast.
- [x] Inline code has a distinct background.
- [ ] Review the same content in light and dark themes.
- [ ] Check borders, syntax highlighting, and keyboard focus.

### Rollout sequence

1. Prepare the preview.
   - Compare ordinary prose with **important details**.
   - Inspect a second level of content:
     - Muted labels should still be legible.
     - Borders should separate adjacent surfaces.
2. Review the release with the team.
3. Publish when the checks are complete.

## 2. Surface inventory

| Element | Token or treatment | What to inspect |
| :--- | :--- | :--- |
| Body copy | `text-ink` | Strong contrast against the ink-colored section |
| Supporting text | `text-ink-muted` | Visible, with less emphasis |
| Raised content | `bg-surface` | A distinct nested layer |
| Dividers | `border-edge-muted` | Subtle but visible boundaries |
| Links | [Reference material](https://example.com) | Recognizable interactive text |

## 3. Implementation sketch

The code block includes comments, strings, numbers, booleans, and punctuation so syntax colors can be assessed together.

```typescript
type Review = {
  title: string;
  approved: boolean;
  depth: number;
};

const reviews: Review[] = [
  { title: 'Typography', approved: true, depth: 0 },
  { title: 'Nested surfaces', approved: false, depth: 2 },
];

// Keep the content readable at every depth.
function summarize(items: Review[]): string {
  const ready = items.filter((item) => item.approved);
  return `${ready.length} of ${items.length} checks complete`;
}
```

### Example payload

```json
{
  "section": "release-notes",
  "inverted": true,
  "checks": ["text", "tables", "code", "nested layers"],
  "remaining": 2
}
```

---

## 4. Final review

Read this longer paragraph at a comfortable width, then compare it with the compact table and code above. A successful result keeps the document’s hierarchy intact: the title leads, section headings divide the work, quotes stand apart, and ordinary prose remains easy to follow. None of these elements should need special colors at the call site merely because the surrounding section uses the app’s ink color as its background.

**Next step:** finish the remaining checks and share the preview.
