# Macro SDK documentation

The public SDK source and its comments are the source of truth. TypeDoc and
typedoc-plugin-markdown generate a canonical Markdown hierarchy and an HTML
reference from one reflection model, including linked API request and response
types. Private, protected and internal members are excluded.
Object alias declarations show their concrete fields and keep linked types and
property descriptions.

The website opens with the authored [SDK guide](pages/home.md): a quick start,
an entity directory in plain English, and links into the generated reference.
TypeDoc resolves those links for both HTML and Markdown. Edit that guide for
introductory prose and SDK source comments for API documentation. Test files
are excluded from the reference.

From this directory:

```sh
bun run build
bun run type-check
bun run test
bun run docs:dev
```

`bun run build` renders the Markdown and HTML into ignored `dist/docs/`; nothing
generated is committed. `bun run test` builds them before testing public
contracts. Edit SDK source comments or declarations and rebuild to see the
result.

Wrangler serves the HTML as static assets without a request handler, credentials,
database or model calls. It builds the docs before serving them. To publish to
your configured Cloudflare account, run `bun run docs:deploy`.

The production address is `https://sdk.macro.com`, configured as a Worker
custom domain. The `Deploy SDK Docs` workflow publishes relevant changes on
`main` using the repository's Cloudflare credentials; manual deployments are
also restricted to `main`. The hostname becomes live with the first successful
deployment. The Worker also retains its account's `workers.dev` address.

Other build packages can import `renderSdkDocs` from
`@macro-inc/sdk-docs/render` and consume the canonical Markdown. This package
does not create Deno bundles or backend artifacts.
