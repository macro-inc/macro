# GitHub App webhook registration

[`app-webhooks.json`](app-webhooks.json) is the reviewed **webhook subscription
specification**: 33 event names and the minimum repository permissions needed
to receive them. Its keys use GitHub App manifest syntax, but it is only a
fragment, not a complete app creation manifest or a deployment mechanism.
Nothing reads it to change a live registration. Tests consume its event list
through the existing ingestion and routine admission code.

## What exists today

There are two integrations, with separate credentials:

- Account linking uses `GithubClientId` / `GithubClientSecret` in
  `authentication_service`. `github_oauth_client.rs` requests the classic OAuth
  scopes `repo user:email`; FusionAuth stores the grant. Settings' GitHub
  connection and the GitHub AI connection use this link. Those scopes stay
  unchanged. A classic OAuth app cannot subscribe to app-level webhooks.
- `infra/stacks/fusionauth-instance/index.ts` separately provisions FusionAuth's
  GitHub identity-provider configuration (OAuth endpoints, client references,
  and `openid profile email offline user:email offline_access` as its configured
  scope string). That is not a GitHub App registration or the scope string
  constructed by the explicit account-link flow. It also stays unchanged.
- Repository sync uses a **GitHub App**. Document storage constructs
  `GithubSyncConfig` from `GithubSyncAppUrl`, `GithubSyncAppClientId`,
  `GithubSyncAppClientSecret`, `GithubSyncAppPemSecretKey`,
  `GithubWebhookSecretKey`, and `GithubInstallationStateSecret`.
  `GET /github/install-sync` starts installation with signed state;
  `GET /github/sync-redirect` verifies the callback and claims the installation
  for the linked account or team. Its OAuth setup code exchange identifies the
  installing user; it does not turn the App into a classic OAuth app.
- Settings' repository installation link calls document storage separately
  from account linking. A connected OAuth account alone does not install the App.
- No preexisting App creation manifest, permission list, event list, or Pulumi
  resource manages the GitHub registration. The deployed permission/subscription
  baseline is unknown from the repository; inspect it in GitHub before applying
  the specification. Do not infer it from the handlers or frontend presets.

The code paths are `apps/web/src/features/settings/GitHub.tsx`,
`apps/web/src/lib/core/auth/authorize-github.ts`,
`services/authentication_service/src/api/link/github.rs`,
`services/authentication_service/src/api/oauth2/github.rs`, and this crate's
`src/inbound/github_sync_router.rs` and `src/domain/service/sync.rs`.

## Ingestion and routines

```text
GitHub App → POST /github/webhook (document storage)
           → HMAC-SHA256 over raw body, constant-time verification
           → existing PR/installation sync handlers
           → macro.github_webhooks (key = installation id)
           → scheduled_action event admission → routine → agent
```

`X-GitHub-Event` stays an open string. Unknown sync events are still published;
adding an event does not require an enum variant or a new database adapter.
Publication is attempted even if a sync handler fails. Invalid signatures fail
before publication. `GithubWebhookReceived` extracts the installation,
repository, optional action and optional sender. Events without an installation
are acknowledged but are not published to routines: there is no installation
claim with which to authorize them.

Payloads lose API links, node IDs and the installation object. Web links
(`html_url`) remain. If the compacted JSON exceeds 64 KiB, only metadata travels;
payload filters cannot match missing data. This is not a lossless event archive.
No new Kafka topic, schema version, OAuth scope, API route or SDK method is needed.
Existing HTTP/service spans and Kafka trace propagation cover this path.

Routines can filter event names, actions, repositories and payload fields. Empty
lists mean any; action filters cannot match events such as `push` that have no
action. Bots/apps are excluded unless explicitly enabled. Access is checked at
admission and execution against the linked account's installation claim or team
claim. The payload is untrusted input, never an authorization grant.

Existing presets cover workflows, PRs, reviews, issues, comments, pushes and
releases. **Any GitHub event** supports the remaining subscribed names without
new UI or parser handlers. A preset is not evidence the App is subscribed.

Kafka replay deduplicates on the broker event ID. A separate HTTP redelivery
from GitHub gets a fresh broker event ID, even when `X-GitHub-Delivery` repeats,
so it can run a routine again. Redeliver only against a controlled test routine;
GitHub delivery-level deduplication is a separate follow-up. Broad wildcard
routines can also run much more often once additional subscriptions are enabled.

## Permission decision

All ten entries in `default_permissions` are **minimum read permissions for
webhooks**, not the complete permission set for the integration:

| Repository permission (manifest key) | Purpose |
| --- | --- |
| Actions (`actions`) | Workflow runs and jobs |
| Checks (`checks`) | Check runs and suites |
| Contents (`contents`) | Pushes, refs, releases, wiki, commit comments, dispatch |
| Deployments (`deployments`) | Deployment lifecycle and reviews |
| Discussions (`discussions`) | Discussions and replies |
| Issues (`issues`) | Issues, dependencies, hierarchy and issue/PR comments |
| Merge queues (`merge_queues`) | Merge group events |
| Metadata (`metadata`) | Repository visibility/lifecycle and labels; mandatory for Apps |
| Pull requests (`pull_requests`) | PR lifecycle, reviews, comments and threads |
| Commit statuses (`statuses`) | Commit status changes |

Add missing read permissions only. **Preserve existing write permissions used by
other features**, including PR commenting and narrowly scoped agent tokens; do
not replace the live registration with this read-only fragment. This change
requests no new write, account or organization permissions and no security-alert
permissions. Even read grants expose additional private repository information,
including workflow logs, so app owners must review the actual delta before saving.

Checks read access observes results; write access is needed for check-run
`rerequested`/`requested_action` and check-suite `requested`/`rerequested`. We do
not request write access for those control actions. GitHub also restricts check
and workflow delivery in some app-created/check-suite scenarios. Subscribing does
not guarantee every action in every repository; repository selection, feature
availability and GitHub's per-event rules still apply.

## Apply manually after review

1. In the owning GitHub account or organization, open **Settings → Developer
   settings → GitHub Apps → Edit** for the app identified by `GithubSyncAppUrl`
   and `GithubSyncAppClientId`. Do not edit the separate OAuth App.
2. Record the existing permissions and subscriptions in a private operational
   record, not this public repository. Compare against `app-webhooks.json`.
3. Under **Permissions & events → Repository permissions**, add only missing
   read permissions from the table above. Keep required existing write grants;
   leave organization/account/security permissions unchanged.
4. Under **Subscribe to events**, select every `default_events` entry (GitHub
   displays human-readable names). Preserve existing subscriptions needed by
   other features. Installation and installation-repository events arrive
   automatically and are not manual checkboxes. Save changes.
5. Under **General → Webhook**, confirm **Active**, SSL verification, and the
   existing HTTPS document-storage webhook URL ending `/github/webhook`.
   Keep the existing webhook secret, App private key, OAuth callback and setup
   URLs. This work needs no secret rotation, Doppler edit or deployment.
6. Each installation owner must approve any new repository permissions via
   the permission-update notice or **Settings → Applications → Installed GitHub
   Apps → Configure → Review request** (for an organization, its **Settings →
   GitHub Apps → Installed GitHub Apps**). New permissions do not take effect
   until accepted. New installations accept the current set at installation.
   An event-only addition using permissions already granted does not require
   a new permission approval. Reconnecting the classic OAuth account is not
   the installation approval step.
7. Use a controlled repository included in an approved installation. Create an
   issue/comment and PR/review, push a commit, complete a workflow and publish
   a release. Check **Advanced → Recent deliveries** for the expected event
   headers and 2xx responses, then verify matching routine runs and payloads.
   Test workflow-job/check-suite events with **Also run for bots and apps** set
   where appropriate. Confirm a nonmatching repository and an account without
   an installation claim do not run the routine. A ping only tests the endpoint;
   it does not prove installation routing or routine access.
8. For rollback, restore the previous event selections first. Do not remove
   permissions still needed by other features. Keep wildcard routines disabled
   during troubleshooting if they could cause repeated external actions.

The repository change does **not** claim that any live app is now subscribed.
The exact permission increase and installations awaiting approval can only be
established when the app owner compares and applies these settings.

## Event inventory

The table covers the event names in the [GitHub webhook reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
reviewed on 2026-11-06. Permissions are GitHub's documented minimum for App
subscription; they are not OAuth scopes. Deferred entries are intentional, not
parser restrictions. For Projects v2 the reference lists organization webhook
availability as well as organization Projects permission guidance; do not assume
it is available on this App without checking GitHub's registration UI.

| Event | Requirement | Decision / routine use |
| --- | --- | --- |
| `branch_protection_configuration` | Administration read (repository) | Defer — organization or administrative access/workflow |
| `branch_protection_rule` | Administration read (repository) | Defer — organization or administrative access/workflow |
| `check_run` | Checks read (repository) | Subscribe — CI results per check |
| `check_suite` | Checks read (repository) | Subscribe — Aggregate CI results |
| `code_scanning_alert` | Code scanning alerts read (repository) | Defer — separate security-data access decision |
| `commit_comment` | Contents read (repository) | Subscribe — Code discussion |
| `create` | Contents read (repository) | Subscribe — New branches/tags |
| `custom_property` | Custom properties read (organization) | Defer — organization or administrative access/workflow |
| `custom_property_values` | Custom properties read (organization) | Defer — organization or administrative access/workflow |
| `delete` | Contents read (repository) | Subscribe — Removed branches/tags |
| `dependabot_alert` | Dependabot alerts read (repository) | Defer — separate security-data access decision |
| `deploy_key` | Deployments read (repository) | Defer — credential administration, not routine work |
| `deployment` | Deployments read (repository) | Subscribe — Deployment started |
| `deployment_protection_rule` | Deployments read (repository) | Defer — requires an explicit approval callback implementation |
| `deployment_review` | Deployments read (repository) | Subscribe — Approval requests and decisions |
| `deployment_status` | Deployments read (repository) | Subscribe — Deployment result |
| `discussion` | Discussions read (repository) | Subscribe — Repository discussion triage |
| `discussion_comment` | Discussions read (repository) | Subscribe — Discussion replies |
| `fork` | Contents read (repository) | Subscribe — Downstream repository activity |
| `github_app_authorization` | Automatic; no extra permission | Automatic; only installation-bearing deliveries reach routines |
| `gollum` | Contents read (repository) | Subscribe — Wiki changes |
| `installation` | Automatic; no extra permission | Automatic; only installation-bearing deliveries reach routines |
| `installation_repositories` | Automatic; no extra permission | Automatic; only installation-bearing deliveries reach routines |
| `installation_target` | App lifecycle; no additional permission documented | Lifecycle; no new grant requested |
| `issue_comment` | Issues read (repository) | Subscribe — Issue and PR conversation |
| `issue_dependencies` | Issues read (repository) | Subscribe — Dependency changes |
| `issue_relates_to` | Issues read (repository) | Subscribe — Related issue changes |
| `issues` | Issues read (repository) | Subscribe — Issue triage and lifecycle |
| `label` | Metadata read (repository) | Subscribe — Label changes |
| `marketplace_purchase` | Marketplace listing webhook | Not part of this GitHub App subscription |
| `member` | Members read (organization) | Defer — organization or administrative access/workflow |
| `membership` | Members read (organization) | Defer — organization or administrative access/workflow |
| `merge_group` | Merge queues read (repository) | Subscribe — Merge queue checks |
| `meta` | Meta read (app) | Defer — app/global event without a routine installation claim |
| `milestone` | Issues / Pull requests read (repository) | Subscribe — Planning milestones |
| `org_block` | Administration read (organization) | Defer — organization or administrative access/workflow |
| `organization` | Members read (organization) | Defer — organization or administrative access/workflow |
| `package` | Repository/organization webhook; not an App event | Not part of this GitHub App subscription |
| `page_build` | Pages read (repository) | Defer — separate Packages/Pages grant when a routine needs it |
| `personal_access_token_request` | Personal access token requests read (organization) | Defer — organization or administrative access/workflow |
| `ping` | Sent when a webhook is configured; no extra permission | Automatic; only installation-bearing deliveries reach routines |
| `project` | Projects read (repository or organization) | Defer — legacy project integration |
| `project_card` | Projects read (repository or organization) | Defer — legacy project integration |
| `project_column` | Projects read (repository or organization) | Defer — legacy project integration |
| `projects_v2` | Projects read (organization) | Defer — organization Projects grant and access model; docs list organization availability |
| `projects_v2_item` | Projects read (organization) | Defer — organization Projects grant and access model; docs list organization availability |
| `projects_v2_status_update` | Projects read (organization) | Defer — organization Projects grant and access model; docs list organization availability |
| `public` | Metadata read (repository) | Subscribe — Visibility change |
| `pull_request` | Pull requests read (repository) | Subscribe — PR lifecycle and review requests |
| `pull_request_review` | Pull requests read (repository) | Subscribe — Review decisions |
| `pull_request_review_comment` | Pull requests read (repository) | Subscribe — Inline review discussion |
| `pull_request_review_thread` | Pull requests read (repository) | Subscribe — Resolved/reopened threads |
| `push` | Contents read (repository) | Subscribe — Commits and branch updates |
| `registry_package` | Packages read (repository) | Defer — separate Packages/Pages grant when a routine needs it |
| `release` | Contents read (repository) | Subscribe — Release announcements |
| `repository` | Metadata read (repository) | Subscribe — Repository lifecycle |
| `repository_advisory` | Repository security advisories read (repository) | Defer — separate security-data access decision |
| `repository_dispatch` | Contents read (repository) | Subscribe — Explicit integration signals |
| `repository_import` | Repository/organization webhook; not an App event | Not part of this GitHub App subscription |
| `repository_ruleset` | Administration read (repository or organization) | Defer — organization or administrative access/workflow |
| `repository_vulnerability_alert` | Repository/organization webhook; deprecated, use dependabot_alert | Not part of this GitHub App subscription |
| `secret_scanning_alert` | Secret scanning alerts read (repository) | Defer — separate security-data access decision |
| `secret_scanning_alert_location` | Secret scanning alerts read (repository) | Defer — separate security-data access decision |
| `secret_scanning_scan` | Secret scanning alerts read (repository) | Defer — separate security-data access decision |
| `security_advisory` | App event; no additional permission documented | Defer — app/global event without a routine installation claim |
| `security_and_analysis` | Administration read (repository) | Defer — organization or administrative access/workflow |
| `sponsorship` | Sponsors listing webhook | Not part of this GitHub App subscription |
| `star` | Metadata read (repository) | Defer — popularity notifications add noise |
| `status` | Commit statuses read (repository) | Subscribe — Commit status results |
| `sub_issues` | Issues read (repository) | Subscribe — Issue hierarchy |
| `team` | Members read (organization) | Defer — organization or administrative access/workflow |
| `team_add` | Members read (organization) | Defer — organization or administrative access/workflow |
| `watch` | Metadata read (repository) | Defer — popularity notifications add noise |
| `workflow_dispatch` | Contents read (repository) | Subscribe — Manual workflow signals |
| `workflow_job` | Actions read (repository) | Subscribe — Job progress and results |
| `workflow_run` | Actions read (repository) | Subscribe — Workflow progress and results |

GitHub's [registration modification guide](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)
explains permission approval and event selection. The [App manifest guide](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
describes the fragment's `default_permissions` / `default_events` keys; a manifest
creates an app and does not update an existing registration.
