# Lexical Core
`lexical core` defines the nodes, plugins, and transformers that are required for interoperability between our
front end Lexical editors and the back end document transformation features. All files in this package
should ONLY import from lexical or from other files in this package.

`canvas-text.ts` shares bounded Lexical JSON validation, plain-text seeds and
extraction between Canvas and its headless AI worker. Geometry, typography and
asset policy stay with Canvas.
