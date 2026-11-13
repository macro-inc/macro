/**
 * `@macro-inc/sdk/lexical`: Macro's Lexical nodes, their `$create…`/`$is…`
 * helpers, the `@lexical/*` nodes documents use, node ids, the markdown
 * transformers and `createDocumentEditor()`. Import `lexical` itself for
 * `$getRoot` and the core nodes; both share one module instance with the
 * editor `Document.lexical()` returns. Needs the optional peer dependencies
 * `lexical` and `@lexical/*` at the version the SDK pins.
 */
export * from './vendor/lexical-core/sdk';
