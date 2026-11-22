# Document reference decorator hosts

DocumentMention, DocumentCard and DatabaseCard share their production UI through
DocumentMentionHost and DocumentCardHost. Their Source adapters retain the actual
Lexical wrapper, command registration, update tags, selection, preview ownership
and cleanup. Each component accepts an optional supplied host. Source callers
continue to resolve the inherited wrapper at construction.

DocumentMention.tsx retains the preview/provider assembly.
DocumentMentionInner.tsx holds the shared inner UI and Normal Enter listener.
The listener observes published selection and remains synchronous. An earlier
Normal listener can change pending selection while this component still handles
the published NodeSelection. Navigation uses the actual app split manager.

DocumentCard delegates its durable identity lookup and preview component registry
to its host. DatabaseCard observes the live block parameters through that host.
The optional layoutChanged capability is supplied by Source's actual layout
notification. A native host must supply that capability only when a real layout
owner exists.

The Source fixture in document-mention-browser-test renders the actual wrappers,
metadata and selection plugins, registered decorators, query providers and
navigation boundary. Its baseline and extracted runs use separate browser
contexts and compare literal model JSON and DOM. The dependency attachment
verifies the producing Vite cache maps and actual loaded script bodies against
the pristine Lexical and code-core sources.

Run from apps/web with DOCUMENT_MENTION_BASELINE pointing to an owned capture
directory, DOCUMENT_MENTION_PHASE=before for original captures and after for
comparisons, and STATIC_HOST_PHASE=before/after for the static-preview cohort.
Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH and
PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH independently. Run:

    bunx playwright test --config src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/playwright.config.ts

DOCUMENT_MENTION_SHAPE=card selects the three card render/selection cases.
Use a new report/output directory for each run. The static-preview native outer
boundary uses the actual view's selection context around a Source StaticMarkdown
preview. Its five fixture WASM files must come from one recorded seal.

The native document hosts and typed adapter rows require the actual document
action/query producer, signature revision metadata, real ordered Normal Enter
and published editability. Each context belongs to one acknowledged view
generation and owns its subscriptions and cached preview disposal. Card identity
comes from the read-only typed native query; rendering never allocates an ID.
Preview height notifications require a handled native update. An admitted equal
height still notifies, while Read, CommentOnly and wrong-type refusals do not.
The optional notification remains absent when no real layout owner exists.

The native render/selection cohort imports the same frozen Source model into
both engines before observing components. It registers Source metadata before
real parse/set and retains fresh-factory captures separately. Supply
DOCUMENT_MENTION_NATIVE_MANIFEST for the exact five-file private seal. Dependency
attachments check the actual served WASM bytes, generated glue source and
served glue response hash in addition to the producing pristine Source scripts.
Use a separate artifact directory and report epoch; never replace old RED
receipts or normalize model/DOM comparisons.

Render/selection equality does not establish conversion/actions, navigation,
cached preview remounts, complete authorization behavior or app registration.
Those require their own matched-seal controls before app-row activation. The
layout callback is not a main-commit or uploaded-file ownership receipt.
