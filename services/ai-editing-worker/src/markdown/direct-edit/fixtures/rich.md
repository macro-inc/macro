# Garden Plan

Intro paragraph for the invented garden plan, written by <m-user-mention>{"userId":"macro|ann@example.com","email":"ann@example.com","displayName":"Ann Example"}</m-user-mention> with a comment target here.

Group: <m-group-mention>{"groupAlias":"gardeners"}</m-group-mention> and contact <m-contact-mention>{"contactId":"c-123","name":"Bob Builder","emailOrDomain":"bob@example.org","isCompany":false}</m-contact-mention>.

See <m-document-mention>{"documentId":"doc-aaa","blockName":"unknown","documentName":"Seed Catalog","blockParams":{},"collapsed":false}</m-document-mention> before <m-date-mention>{"date":"2026-03-01","displayFormat":"MMM d, yyyy","mentionUuid":"d-1"}</m-date-mention>.

Inline math $a^2+b^2=c^2$ and **bold**, *italic*, `code`, ~~strike~~, <m-link>{"url":"https://example.com/plants","text":"a link","title":""}</m-link>.

## Beds

- Tomatoes
- Peppers
  - Sweet
  - Hot
- Beans

1. Dig
2. Plant
3. Water

- [ ] Buy compost
- [x] Order seeds

> A quoted line about soil.

<m-table><m-table-row><m-table-cell header="row">Bed</m-table-cell><m-table-cell header="row">Crop</m-table-cell><m-table-cell header="row">Notes</m-table-cell></m-table-row><m-table-row><m-table-cell>North</m-table-cell><m-table-cell colspan="2">Squash, wide</m-table-cell></m-table-row><m-table-row><m-table-cell rowspan="2">South</m-table-cell><m-table-cell>Kale</m-table-cell><m-table-cell>shade</m-table-cell></m-table-row><m-table-row><m-table-cell>Chard</m-table-cell><m-table-cell>sun</m-table-cell></m-table-row></m-table>

![A bed diagram](https://example.com/bed.png)

<m-video>{"url":"https://example.com/tour.mp4","srcType":"url","id":"","width":640,"height":360,"scale":1,"controls":true}</m-video>

```python
def water(bed):
    return bed * 2
```

<m-katex-equation>{"equation":"V = l \\cdot w \\cdot h","inline":false}</m-katex-equation>

<m-document-card>{"documentId":"doc-bbb","blockName":"md","documentName":"Harvest Log","blockParams":{},"previewBox":["100%","400px"],"previewData":null}</m-document-card>

A paragraph with a private highlight in it.

---

Closing paragraph with a final note.