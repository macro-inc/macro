# Pinned comparison exception

`compareNumberWithUpstreamType(a, b): -1 | 0 | 1` returns exactly
`Math.sign(a - b)` through the sole approved assertion for numeric ordering.
Its only product call site is `$comparePointCaretNext` in `ancestry.ts`, when
both carets point into text on the same node. No finite check, offset validation,
clamp or throw is added. No root export of this internal adapter is intended.

The immutable v0.45.0 source at commit
`ead730cf50f4d3e3f93b7c1d23a443a6d14f50d1` contains exactly one `Math.sign`
occurrence across package sources: `packages/lexical/src/caret/LexicalCaret.ts`
line 1207, inside `compareNumber`. That source file SHA-256 is
`a52bdcf014f191a7d07a4ec76ce6477e04bf4d61d298cc5b4f37e95136687a49`.

A frozen-Original real-editor update creates a text node, constructs its text
caret with offset `Number.NaN`, then assigns `$comparePointCaretNext(caret,
caret)` to a variable declared `-1 | 0 | 1`. Both the stored offset and the
comparison result are NaN at runtime. The captured source SHA-256 is
`0ccc99e38cbf7a1c59135245283778c45006afd4475b5ba365d7c6df24a3e399`;
the result JSON SHA-256 is
`84bc6ca0f2379fca035e8d521e79e0ead26c549226fd40eb198b36b35db4847e`.
The capture is source-runtime evidence, with `nativeAcceptance: false`.

The public comparison type is checked in `comparison.type-test.ts`; focused
runtime tests cover ordinary ordering, signed zero, infinities and NaN. The
remaining caret producer is a separate source port, not implied by this adapter
checkpoint. None of these checks count toward the real-engine upstream oracle.
