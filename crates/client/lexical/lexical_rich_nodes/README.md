# Lexical rich nodes

Model halves of Lexical v0.45.0, layered on `lexical_model`. Node payloads hold
only their own serialized fields; the core owns tree links, element/text data,
selection and update processing. This crate has no I/O, browser, or server runtime.

`register_rich_text_nodes` registers HeadingNode and QuoteNode. OverflowNode has
an intrinsic transform that removes empty wrappers and delegates new-block
insertion to its parent. Register it explicitly when needed.

The literal tests in `heading/test.rs` and `quote/test.rs` port upstream
LexicalHeadingNode and LexicalQuoteNode model tests, including empty/middle/end
insertion, level changes and collapse-at-start behavior. DOM construction,
updates, import rules and rendered HTML assertions belong to the view or HTML
port. `overflow/test.rs` covers its intrinsic transform and parent delegation;
upstream has no standalone overflow unit suite.

The upstream algorithms and pattern data are MIT-licensed; see LICENSE-LEXICAL.
See AGENTS.md for validation commands and module boundaries.
