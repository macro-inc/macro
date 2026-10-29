# Type Alias: ApiEntityFilterAst

> **ApiEntityFilterAst** = \{ `asf?`: `unknown`; `calf?`: `unknown`; `callf?`: `unknown`; `ccf?`: `unknown`; `cf?`: `unknown`; `chanf?`: `unknown`; `crma?`: `null` \| [`CrmAssociation`](CrmAssociation.md); `crmf?`: `unknown`; `cthf?`: `unknown`; `df?`: `unknown`; `eca?`: `string`[]; `ecd?`: `string`[]; `ef?`: `unknown`; `favorites_only?`: `boolean` \| `null`; `fef?`: `unknown`; `ghprf?`: `unknown`; `pf?`: `unknown`; `propf?`: `unknown`; \}

Wire-format entity filter AST accepted by soup AST endpoints.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asf"></a> `asf?` | `unknown` | Filters applied to agent sessions (wire key `asf`). An empty or omitted filter returns **no** agent sessions: they are opt-in, so the caller must send `inc`, an id, or an owner to get any. |
| <a id="property-calf"></a> `calf?` | `unknown` | filters applied to canonical calendar events |
| <a id="property-callf"></a> `callf?` | `unknown` | the filters that should be applied to the call entity |
| <a id="property-ccf"></a> `ccf?` | `unknown` | Filters applied to the crm_company entity (wire key `ccf`). Empty/omitted = team's full visible list. |
| <a id="property-cf"></a> `cf?` | `unknown` | the filters that should be applied to the chat entity |
| <a id="property-chanf"></a> `chanf?` | `unknown` | the filters that should be applied to the channel entity |
| <a id="property-crma"></a> `crma?` | `null` \| [`CrmAssociation`](CrmAssociation.md) | - |
| <a id="property-crmf"></a> `crmf?` | `unknown` | Opt-in filters for viewer-accessible CRM contacts (wire key `crmf`). |
| <a id="property-cthf"></a> `cthf?` | `unknown` | the filters that should be applied to the channel-thread entity |
| <a id="property-df"></a> `df?` | `unknown` | the filters that should be applied to the document entity |
| <a id="property-eca"></a> `eca?` | `string`[] | CRM-scoped address filter (wire key: `eca`). Symmetric counterpart to `ecd` for fully-qualified email addresses. |
| <a id="property-ecd"></a> `ecd?` | `string`[] | CRM-scoped domain filter (wire key: `ecd`). Parallel to the freeform `ef` AST. Expanded by the router into an any-direction OR sub-tree AND-merged into `ef`, plus a `CrmScope` tag stamped on the resulting [`item_filters::ast::EmailFilterAst::crm_scope`]. Drives the per-team CRM authorization pre-check and candidate-set widening downstream. Mutually exclusive with `eca`. |
| <a id="property-ef"></a> `ef?` | `unknown` | the filters that should be applied to the email entity (raw AST tree only; CRM scope is carried by the `ecd` / `eca` sibling fields). On this endpoint the email filter stays a bare tree, unlike the materialized [`EntityFilterAst`] used for cursors. |
| <a id="property-favorites_only"></a> `favorites_only?` | `boolean` \| `null` | Restrict to the authenticated viewer's favorites before pagination when true. |
| <a id="property-fef"></a> `fef?` | `unknown` | the filters that should be applied to foreign entity records |
| <a id="property-ghprf"></a> `ghprf?` | `unknown` | the filters that should be applied to GitHub pull request records, on top of `fef` |
| <a id="property-pf"></a> `pf?` | `unknown` | the filters that should be applied to the project entity |
| <a id="property-propf"></a> `propf?` | `unknown` | the filters that should be applied based on entity properties |
