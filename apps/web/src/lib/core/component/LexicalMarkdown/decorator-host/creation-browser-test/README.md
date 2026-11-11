# Creation callback controls

This fixture uses the actual Source wrapper, plugins, nodes, split manager and
popover registration. It invokes the callbacks retained on the real popover;
it does not submit the task/document service or mount the composer dialog.

Compare completed editor model/DOM bytes before and after changes to
`editing/overlay-hosts/{creation,lexical-creation}.ts` in Chromium, Firefox and
WebKit. The fixture assigns node IDs through `$setId` before publication and
uses a fixed clock. No captured values are normalized. Pending placeholders
have opaque generated await IDs: assert their actual outer mount count, then
compare the completed stages after failure or replacement removes them.

Each run verifies the exact app Vite dependency maps and the actual served
Lexical/code-core scripts against pristine package source hashes. Warm the
actual fixture first so optimization finishes before the execution witness.

The unit controls exercise retained callbacks after editability changes, a
removed placeholder, and mention tracking that finishes after failure. Source
programmatic edits remain synchronous. Native callbacks must own their serialized
command completion and access checks. A composer-open request is not insertion
evidence; no native composer binding or registry activation is included here.
