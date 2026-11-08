
`d6_collapse_code_highlight` is selected only when a fixture registers
`@lexical/code-prism.registerCodeHighlighting` (S4 §1.7, `codeHighlight`, D6).
The admitted legacy corpus uses `codeHighlight` for 69 of these fixtures and
no highlight declaration for five that start with empty code. GOALS round 3
explicitly authorizes this named replacement policy for all 74; activation
requires the pinned `LexicalCodeNodeTabs.test.ts` source and the registration
having executed. Future fixtures may declare the new name explicitly. Other
sources retain strict comparison even if they register Prism.
It currently admits exactly one code block with text/highlight, tab and linebreak
children. Both snapshots collapse compatible highlight/text runs and compare
code selection positions as absolute UTF-16 offsets. Text, attributes, language,
root properties, JSON field order, tags, selection direction and typing fields
remain exact. Raw node maps must contain every raw JSON node exactly once.
Highlight-body allocation, normalization and dirtiness project to the code unit;
root dirty intent stays exact. Code-body aliases disappear only when the oracle
removes them. Handle versions and non-highlight types remain exact. Unsupported
mixed or nested content fails. Generic `codeHighlight` fixtures retain their
previous exact identity and bookkeeping comparisons.

The Prism registration also enables the existing code indentation command
handlers and the upstream default language initialization (`javascript`). It
never tokenizes text or creates highlight records.

Within this closed code-only topology, the numeric allocation interval up to the
largest observed Prism key belongs to code-body allocation (including plain
runs replaced before the first snapshot). Unobserved keys above that interval,
non-body handles and duplicate dirty/normalized set entries fail. Model body
identities must occur under code in the current or previous snapshot. The
recorded Prism code-container write must be intentional; physical model leaf
writes may mark only its ancestor, so both project to an intentional code-unit
write.
