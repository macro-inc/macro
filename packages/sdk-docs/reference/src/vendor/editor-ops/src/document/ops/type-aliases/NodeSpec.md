# Type Alias: NodeSpec

> **NodeSpec** = \{ `block`: `"paragraph"`; `text?`: `string`; \} \| \{ `block`: `"heading"`; `level`: `1` \| `2` \| `3` \| `4` \| `5` \| `6`; `text?`: `string`; \} \| \{ `block`: `"quote"`; `text?`: `string`; \} \| \{ `block`: `"code"`; `language`: `string`; `text?`: `string`; \} \| \{ `block`: `"list"`; `items`: `string`[]; `list`: [`ListKind`](ListKind.md); \} \| \{ `block`: `"table"`; `rows`: `string`[][]; \} \| \{ `block`: `"divider"`; \} \| \{ `block`: `"document-card"`; `blockName`: `string`; `blockParams?`: `Record`\<`string`, `string`\>; `documentId`: `string`; `documentName`: `string`; \} \| \{ `block`: `"html-render"`; `html`: `string`; \} \| \{ `block`: `"database-query"`; `query`: `string`; \} \| \{ `alt?`: `string`; `block`: `"image"`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \} \| \{ `block`: `"video"`; `controls?`: `boolean`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \} \| \{ `block`: `"equation"`; `inline?`: `boolean`; `tex`: `string`; \} \| \{ `inline`: `"linebreak"`; \} \| \{ `inline`: `"equation"`; `tex`: `string`; \} \| \{ `date`: `string`; `displayFormat?`: `string`; `inline`: `"date"`; \} \| \{ `inline`: `"mention"`; `mention`: [`MentionSpec`](MentionSpec.md); \} \| \{ `inline`: `"database-query"`; `query`: `string`; \}

Declarative description of a node to build. `buildNode(spec)` (doc/doc.ts)
 turns it into real Lexical nodes; the queue uses `text` to plan typing.

## Union Members

### Type Literal

\{ `block`: `"paragraph"`; `text?`: `string`; \}

***

### Type Literal

\{ `block`: `"heading"`; `level`: `1` \| `2` \| `3` \| `4` \| `5` \| `6`; `text?`: `string`; \}

***

### Type Literal

\{ `block`: `"quote"`; `text?`: `string`; \}

***

### Type Literal

\{ `block`: `"code"`; `language`: `string`; `text?`: `string`; \}

***

### Type Literal

\{ `block`: `"list"`; `items`: `string`[]; `list`: [`ListKind`](ListKind.md); \}

***

### Type Literal

\{ `block`: `"table"`; `rows`: `string`[][]; \}

***

### Type Literal

\{ `block`: `"divider"`; \}

***

### Type Literal

\{ `block`: `"document-card"`; `blockName`: `string`; `blockParams?`: `Record`\<`string`, `string`\>; `documentId`: `string`; `documentName`: `string`; \}

***

### Type Literal

\{ `block`: `"html-render"`; `html`: `string`; \}

***

### Type Literal

\{ `block`: `"database-query"`; `query`: `string`; \}

`query` is a saved question's `<m-db-query>…</m-db-query>` markdown.

***

### Type Literal

\{ `alt?`: `string`; `block`: `"image"`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \}

***

### Type Literal

\{ `block`: `"video"`; `controls?`: `boolean`; `height?`: `number`; `srcType`: `string`; `url`: `string`; `width?`: `number`; \}

***

### Type Literal

\{ `block`: `"equation"`; `inline?`: `boolean`; `tex`: `string`; \}

***

### Type Literal

\{ `inline`: `"linebreak"`; \}

***

### Type Literal

\{ `inline`: `"equation"`; `tex`: `string`; \}

***

### Type Literal

\{ `date`: `string`; `displayFormat?`: `string`; `inline`: `"date"`; \}

***

### Type Literal

\{ `inline`: `"mention"`; `mention`: [`MentionSpec`](MentionSpec.md); \}

***

### Type Literal

\{ `inline`: `"database-query"`; `query`: `string`; \}

A scalar `<m-db-query>` answer inside a sentence.
