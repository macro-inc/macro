use super::*;

use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_deserialization() -> anyhow::Result<()> {
    let json = serde_json::json!({
      "took": 20,
      "timed_out": false,
      "_shards": {
        "total": 15,
        "successful": 15,
        "skipped": 0,
        "failed": 0
      },
      "hits": {
        "total": {
          "value": 739,
          "relation": "eq"
        },
        "max_score": 27.399992,
        "hits": [
          {
            "_index": "emails",
            "_id": "019a5a07-a1ed-7342-93a7-861582b59a55:019a5a07-b09d-7af9-b6ce-98bced9353d2",
            "_score": 27.399992,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "review_requested@noreply.github.com"
              ],
              "bcc": [],
              "subject": "[macro-inc/macro-api] chore: improve ws api gateway authorizer lambda (PR #2520)",
              "message_id": "019a5a07-b09d-7af9-b6ce-98bced9353d2",
              "entity_id": "019a5a07-a1ed-7342-93a7-861582b59a55",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "## Summary\ntype safety + better deny policy\n## Screenshots, GIFs, and Videos\n## Checklist\n* Included (`MACRO-N`) in the PR title.\n* QA'd\nTests for PR (pick one):\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://github.com/macro-inc/macro-api/pull/2520\n#### Commit Summary\n* 20b26f7 update\n* f39426a make it TS\n#### File Changes\n(6 files)\n* **A** websocket/handlers/authorization-handler/.gitignore (5)\n* **D** websocket/handlers/authorization-handler/index.js (105)\n* **A** websocket/handlers/authorization-handler/index.ts (159)\n* **M** websocket/handlers/authorization-handler/package.json (10)\n* **A** websocket/handlers/authorization-handler/tsconfig.json (18)\n* **M** websocket/infra/index.ts (65)\n#### Patch Links:\n* https://github.com/macro-inc/macro-api/pull/2520.patch\n* https://github.com/macro-inc/macro-api/pull/2520.diff\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2520@github.com>",
              "labels": [
                "github",
                "CATEGORY_PERSONAL",
                "UNREAD",
                "IMPORTANT"
              ],
              "thread_id": "019a5a07-a1ed-7342-93a7-861582b59a55",
              "sent_at_seconds": 1762447040,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1762447044,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                ":\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://<macro_em>github.com</macro_em>",
                "* f39426a make it TS\n#### File Changes\n(6 files)\n* **A** websocket/handlers/authorization-handler/.<macro_em>gitignore</macro_em>",
                "authorization-handler/tsconfig.json (18)\n* **M** websocket/infra/index.ts (65)\n#### Patch Links:\n* https://<macro_em>github.com</macro_em>",
                "/macro-inc/macro-api/pull/2520.patch\n* https://<macro_em>github.com</macro_em>/macro-inc/macro-api/pull/2520.diff\n—\nReply",
                "to this email directly, view it on <macro_em>GitHub</macro_em>, or unsubscribe.",
                "You are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2520@<macro_em>github.com</macro_em>"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "01999c74-fb30-7c8a-b334-16035ee46783:01999c75-1c32-7cf4-a168-7741881ceec3",
            "_score": 22.173065,
            "_source": {
              "cc": [],
              "bcc": [],
              "subject": "From IaC to AI Platform Engineering: Insights You Can’t Afford to Miss",
              "message_id": "01999c75-1c32-7cf4-a168-7741881ceec3",
              "entity_id": "01999c74-fb30-7c8a-b334-16035ee46783",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "Learn, connect, and explore the future of IaC, platform engineering, DevOps, and AI.\n pulumi email banner \nHi Will,\nPulumi is on the move, bringing together communities of builders who are pushing the boundaries of Platform Engineering and DevOps with AI.\nThis is where new ideas surface, best practices are shared first, and the conversations shaping tomorrow’s infrastructure are happening now. Don't miss your chance to be part of it!\n### Pulumi User Groups (PUG) Meetups\nOct 1  São Paulo, BR   Sao Paulo PUG: Evento de Lançamento - Do IaC ao Platform Engineering \nOct 9  Copenhagen, DK PUG In-Person Meetup Nº 1: Discover AI in a DevOps World\nOct 22 London, UK     PUG In-Person Meetup Nº 3: Building Better Platforms with Pulumi IDP\nOct 29 Tel Aviv, IL    In-Person Meetup Nº 2: Platform Engineering and DevOps in the Age of AI \n### Events & Conferences\nOct 8     Copenhagen, DK     Join Engin Diri, Senior Solutions Architect at Pulumi, for his talk on GitOps Promotion Tools to add to your GitOps Toolkit in 2025. \nOct 17    Santa Monica, CA  AWS MCP Hackathon\nOct 27–29 San Francisco, CA TechCrunch Disrupt\nOct 29    Bellevue, WA      MCP Academy\nWe hope to see you soon!\nHappy building,\nThe Pulumi Team\n ai-workshop-series-banner \n cloud-red \nTry Pulumi\n docs \nView Docs\ntwitter         GitHub-Mark-120px-plus      linkedin         youtube-play         slack-2 \n© 2025 Pulumi. All rights reserved.\nPulumi Corporation, Two Union Square, 601 Union St, Pulumi Suite 1415, Seattle, WA 98101\nUnsubscribe Manage preferences",
              "labels": [
                "INBOX",
                "CATEGORY_PROMOTIONS"
              ],
              "sent_at": 1759241406,
              "thread_id": "01999c74-fb30-7c8a-b334-16035ee46783",
              "updated_at": 1759266586,
              "sent_at_seconds": 1759241406,
              "sender": "events@pulumi.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1759266586,
              "recipients": [
                "hutch@macro.com"
              ]
            },
            "highlight": {
              "content": [
                "Oct 8     Copenhagen, DK     Join Engin Diri, Senior Solutions Architect at Pulumi, for his talk on <macro_em>GitOps</macro_em>",
                "Promotion Tools to add to your <macro_em>GitOps</macro_em> Toolkit in 2025.",
                "The Pulumi Team\n ai-workshop-series-banner \n cloud-red \nTry Pulumi\n docs \nView Docs\ntwitter         <macro_em>GitHub</macro_em>-Mark"
              ]
            }
          },
          {
            "_index": "documents",
            "_id": "013021c7-5e14-4aab-855e-01413fff85dc:77",
            "_score": 18.047625,
            "_source": {
              "document_name": "Rust for Rustaceans Idiomatic Programming for Experienced Developers (1)",
              "updated_at": 1752523635,
              "updated_at_seconds": 1752523635,
              "file_type": "pdf",
              "owner_id": "macro|teo@macro.com",
              "document_id": "013021c7-5e14-4aab-855e-01413fff85dc",
              "document_version_id": 10091,
              "entity_id": "013021c7-5e14-4aab-855e-01413fff85dc",
              "content": "74   Chapter 6\r\n[patch.crates-io]\r\n# use a local (presumably modified) source\r\nregex = { path = \"/home/jon/regex\" }\r\n# use a modification on a git branch\r\nserde = { git = \"https://github.com/serde-rs/serde.git\", branch = \"faster\" }\r\n# patch a git dependency\r\n[patch.'https://github.com/jonhoo/project.git']\r\nproject = { path = \"/home/jon/project\" }\r\nListing 6-6: Overriding dependency sources in Cargo.toml using [patch]\r\nEven if you patch a dependency, Cargo takes care to check the crate \r\nversions so that you don’t accidentally end up patching the wrong major version of a crate. If you for some reason transitively depend on multiple major \r\nversions of the same crate, you can patch each one by giving them distinct \r\nidentifiers, as shown in Listing 6-7.\r\n[patch.crates-io]\r\nnom4 = { path = \"/home/jon/nom4\", package = \"nom\" }\r\nnom5 = { path = \"/home/jon/nom5\", package = \"nom\" }\r\nListing 6-7: Overriding multiple versions of the same crate in Cargo.toml using [patch]\r\nCargo will look at the Cargo.toml inside each path, realize that /nom4\r\ncontains major version 4 and that /nom5 contains major version 5, and patch \r\nthe two versions appropriately. The package keyword tells Cargo to look for a \r\ncrate by the name nom in both cases instead of using the dependency identifiers (the part on the left) as it does by default. You can use package this way \r\nin your regular dependencies as well to rename a dependency!\r\nKeep in mind that patches are not taken into account in the package \r\nthat’s uploaded when you publish a crate. A crate that depends on your \r\ncrate will use only its own [patch] section (which may be empty), not that of \r\nyour crate!\r\nCR ATES VS. PACKAGES\r\nYou may wonder what the difference between a package and a crate is. \r\nThese two terms are often used interchangeably in informal contexts, but they \r\nalso have specific definitions that vary depending on whether you’re talking \r\nabout the Rust compiler, Cargo, crates.io, or something else. I personally think \r\nof a crate as a Rust module hierarchy starting at a root .rs file (one where you \r\ncan use crate-level attributes like #![feature])—usually something like lib.rs or \r\nmain.rs. In contrast, a package is a collection of crates and metadata, so essentially all that’s described by a Cargo.toml file. That may include a library crate, \r\nmultiple binary crates, some integration test crates, and maybe even multiple \r\nworkspace members that themselves have Cargo.toml files.\r\nIntermediate Rust (Early Access) © 2022 by Jon Gjengset ",
              "node_id": "77"
            },
            "highlight": {
              "content": [
                "local (presumably modified) source\r\nregex = { path = \"/home/jon/regex\" }\r\n# use a modification on a <macro_em>git</macro_em>",
                "branch\r\nserde = { <macro_em>git</macro_em> = \"https://<macro_em>github.com</macro_em>/serde-rs/serde.git\", branch = \"faster\" }\r\n# patch a <macro_em>git</macro_em>",
                "https://<macro_em>github.com</macro_em>/jonhoo/project.git']\r\nproject = { path = \"/home/jon/project\" }\r\nListing 6-6: Overriding"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a3002-d9ff-79ad-9a5f-c3116b5b229a:019a3002-da01-71aa-aed0-3d699723ba58",
            "_score": 17.734608,
            "_source": {
              "cc": [],
              "bcc": [],
              "subject": "[GitHub] A personal access token (classic) has been regenerated for your account",
              "message_id": "019a3002-da01-71aa-aed0-3d699723ba58",
              "entity_id": "019a3002-d9ff-79ad-9a5f-c3116b5b229a",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "Hey whutchinson98!\r\n\r\nA personal access token (classic) \"zephyr\" with notifications scopes was recently regenerated for your account. Visit https://github.com/settings/tokens for more information.\r\n\r\nTo see this and other security events for your account, visit https://github.com/settings/security-log\r\n\r\nIf you run into problems, please contact support by visiting https://github.com/contact\r\n\r\nThanks,\r\nThe GitHub Team",
              "labels": [
                "INBOX",
                "CATEGORY_UPDATES",
                "UNREAD"
              ],
              "sent_at": 1761742081,
              "thread_id": "019a3002-d9ff-79ad-9a5f-c3116b5b229a",
              "updated_at": 1761742084,
              "sent_at_seconds": 1761742081,
              "sender": "noreply@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761742084,
              "recipients": [
                "will@thehutchery.com"
              ]
            },
            "highlight": {
              "content": [
                "Visit https://<macro_em>github.com</macro_em>/settings/tokens for more information.",
                "To see this and other security events for your account, visit https://<macro_em>github.com</macro_em>/settings/security-log",
                "If you run into problems, please contact support by visiting https://<macro_em>github.com</macro_em>/contact\r\n\r\nThanks",
                ",\r\nThe <macro_em>GitHub</macro_em> Team"
              ]
            }
          },
          {
            "_index": "documents",
            "_id": "71ff8822-b421-4cab-b23e-f65355bf90d4:77",
            "_score": 17.689163,
            "_source": {
              "document_name": "Rust for Rustaceans Idiomatic Programming for Experienced Developers (1)",
              "updated_at": 1752522588,
              "updated_at_seconds": 1752522588,
              "file_type": "pdf",
              "owner_id": "macro|teo@macro.com",
              "document_id": "71ff8822-b421-4cab-b23e-f65355bf90d4",
              "document_version_id": 511386,
              "entity_id": "71ff8822-b421-4cab-b23e-f65355bf90d4",
              "content": "74   Chapter 6\r\n[patch.crates-io]\r\n# use a local (presumably modified) source\r\nregex = { path = \"/home/jon/regex\" }\r\n# use a modification on a git branch\r\nserde = { git = \"https://github.com/serde-rs/serde.git\", branch = \"faster\" }\r\n# patch a git dependency\r\n[patch.'https://github.com/jonhoo/project.git']\r\nproject = { path = \"/home/jon/project\" }\r\nListing 6-6: Overriding dependency sources in Cargo.toml using [patch]\r\nEven if you patch a dependency, Cargo takes care to check the crate \r\nversions so that you don’t accidentally end up patching the wrong major version of a crate. If you for some reason transitively depend on multiple major \r\nversions of the same crate, you can patch each one by giving them distinct \r\nidentifiers, as shown in Listing 6-7.\r\n[patch.crates-io]\r\nnom4 = { path = \"/home/jon/nom4\", package = \"nom\" }\r\nnom5 = { path = \"/home/jon/nom5\", package = \"nom\" }\r\nListing 6-7: Overriding multiple versions of the same crate in Cargo.toml using [patch]\r\nCargo will look at the Cargo.toml inside each path, realize that /nom4\r\ncontains major version 4 and that /nom5 contains major version 5, and patch \r\nthe two versions appropriately. The package keyword tells Cargo to look for a \r\ncrate by the name nom in both cases instead of using the dependency identifiers (the part on the left) as it does by default. You can use package this way \r\nin your regular dependencies as well to rename a dependency!\r\nKeep in mind that patches are not taken into account in the package \r\nthat’s uploaded when you publish a crate. A crate that depends on your \r\ncrate will use only its own [patch] section (which may be empty), not that of \r\nyour crate!\r\nCR ATES VS. PACKAGES\r\nYou may wonder what the difference between a package and a crate is. \r\nThese two terms are often used interchangeably in informal contexts, but they \r\nalso have specific definitions that vary depending on whether you’re talking \r\nabout the Rust compiler, Cargo, crates.io, or something else. I personally think \r\nof a crate as a Rust module hierarchy starting at a root .rs file (one where you \r\ncan use crate-level attributes like #![feature])—usually something like lib.rs or \r\nmain.rs. In contrast, a package is a collection of crates and metadata, so essentially all that’s described by a Cargo.toml file. That may include a library crate, \r\nmultiple binary crates, some integration test crates, and maybe even multiple \r\nworkspace members that themselves have Cargo.toml files.\r\nIntermediate Rust (Early Access) © 2022 by Jon Gjengset ",
              "node_id": "77"
            },
            "highlight": {
              "content": [
                "local (presumably modified) source\r\nregex = { path = \"/home/jon/regex\" }\r\n# use a modification on a <macro_em>git</macro_em>",
                "branch\r\nserde = { <macro_em>git</macro_em> = \"https://<macro_em>github.com</macro_em>/serde-rs/serde.git\", branch = \"faster\" }\r\n# patch a <macro_em>git</macro_em>",
                "https://<macro_em>github.com</macro_em>/jonhoo/project.git']\r\nproject = { path = \"/home/jon/project\" }\r\nListing 6-6: Overriding"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a1675-844c-7dcc-bd45-109c25b94fa0:019a1675-8467-7cb3-b57d-8c5c45d5b50c",
            "_score": 17.500538,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "review_requested@noreply.github.com"
              ],
              "bcc": [],
              "subject": "[macro-inc/macro-api] fix table name in policy (PR #2425)",
              "message_id": "019a1675-8467-7cb3-b57d-8c5c45d5b50c",
              "entity_id": "019a1675-844c-7dcc-bd45-109c25b94fa0",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "#### You can view, comment on, or merge this pull request online at:\nhttps://github.com/macro-inc/macro-api/pull/2425\n#### Commit Summary\n* 624dc3f fix table name in policy\n#### File Changes\n(1 file)\n* **M** cloud-storage/infra/packages/resources/src/resources/frecency.ts (4)\n#### Patch Links:\n* https://github.com/macro-inc/macro-api/pull/2425.patch\n* https://github.com/macro-inc/macro-api/pull/2425.diff\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2425@github.com>",
              "labels": [
                "github",
                "CATEGORY_UPDATES",
                "UNREAD",
                "IMPORTANT"
              ],
              "sent_at": 1761313387,
              "thread_id": "019a1675-844c-7dcc-bd45-109c25b94fa0",
              "updated_at": 1761313391,
              "sent_at_seconds": 1761313387,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761313391,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                "#### You can view, comment on, or merge this pull request online at:\nhttps://<macro_em>github.com</macro_em>/macro-inc/macro-api",
                "** cloud-storage/infra/packages/resources/src/resources/frecency.ts (4)\n#### Patch Links:\n* https://<macro_em>github.com</macro_em>",
                "/macro-inc/macro-api/pull/2425.patch\n* https://<macro_em>github.com</macro_em>/macro-inc/macro-api/pull/2425.diff\n—\nReply",
                "to this email directly, view it on <macro_em>GitHub</macro_em>, or unsubscribe.",
                "You are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2425@<macro_em>github.com</macro_em>"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a3653-c914-769b-9454-3b70dc2ad966:019a3653-cd3b-7b24-9dd7-9090e7d30f65",
            "_score": 17.168581,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "review_requested@noreply.github.com"
              ],
              "bcc": [],
              "subject": "[macro-inc/macro-api] Fix conn gateway var name (PR #2471)",
              "message_id": "019a3653-cd3b-7b24-9dd7-9090e7d30f65",
              "entity_id": "019a3653-c914-769b-9454-3b70dc2ad966",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "just rename the thing\n#### You can view, comment on, or merge this pull request online at:\nhttps://github.com/macro-inc/macro-api/pull/2471\n#### Commit Summary\n* f3e3ab1 rename env var\n#### File Changes\n(1 file)\n* **M** cloud-storage/infra/stacks/connection-gateway/index.ts (2)\n#### Patch Links:\n* https://github.com/macro-inc/macro-api/pull/2471.patch\n* https://github.com/macro-inc/macro-api/pull/2471.diff\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2471@github.com>",
              "labels": [
                "github",
                "CATEGORY_PERSONAL",
                "UNREAD",
                "IMPORTANT"
              ],
              "sent_at": 1761848050,
              "thread_id": "019a3653-c914-769b-9454-3b70dc2ad966",
              "updated_at": 1761848053,
              "sent_at_seconds": 1761848050,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761848053,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                "just rename the thing\n#### You can view, comment on, or merge this pull request online at:\nhttps://<macro_em>github.com</macro_em>",
                "file)\n* **M** cloud-storage/infra/stacks/connection-gateway/index.ts (2)\n#### Patch Links:\n* https://<macro_em>github.com</macro_em>",
                "/macro-inc/macro-api/pull/2471.patch\n* https://<macro_em>github.com</macro_em>/macro-inc/macro-api/pull/2471.diff\n—\nReply",
                "to this email directly, view it on <macro_em>GitHub</macro_em>, or unsubscribe.",
                "You are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2471@<macro_em>github.com</macro_em>"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a12cf-ed6d-7cbc-b705-a78bbbe1bba0:019a12d7-9a39-7ce4-a407-a737db30bdfd",
            "_score": 17.127216,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "comment@noreply.github.com"
              ],
              "bcc": [],
              "subject": "Re: [macro-inc/macro-api] Update macrodb to use sqlx (PR #2423)",
              "message_id": "019a12d7-9a39-7ce4-a407-a737db30bdfd",
              "entity_id": "019a12cf-ed6d-7cbc-b705-a78bbbe1bba0",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "@evanhutnik commented on this pull request.\nIn .github/workflows/db-client-check.yml:\n> @@ -1,12 +1,12 @@\nname: db client check\non:\npull_request:\n-    branches: 'never'\n-    # branches: 'dev', 'prod'\n-    # paths:\n+    branches:  'never' \nimage.png (view on web)\nsometimes it be your own self\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because you commented.Message ID: <macro-inc/macro-api/pull/2423/review/3372627995@github.com>",
              "labels": [
                "github",
                "CATEGORY_PERSONAL",
                "UNREAD",
                "IMPORTANT"
              ],
              "sent_at": 1761252648,
              "thread_id": "019a12cf-ed6d-7cbc-b705-a78bbbe1bba0",
              "updated_at": 1761252711,
              "sent_at_seconds": 1761252648,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761252711,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                "In .<macro_em>github</macro_em>/workflows/db-client-check.yml:\n> @@ -1,12 +1,12 @@\nname: db client check\non:\npull_request:",
                "' \nimage.png (view on web)\nsometimes it be your own self\n—\nReply to this email directly, view it on <macro_em>GitHub</macro_em>",
                "are receiving this because you commented.Message ID: <macro-inc/macro-api/pull/2423/review/3372627995@<macro_em>github.com</macro_em>"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a3575-3540-7231-8b83-51279a1bf623:019a3575-3541-7c31-9857-5dfea488c4c6",
            "_score": 17.092716,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "review_requested@noreply.github.com"
              ],
              "bcc": [],
              "subject": "[macro-inc/macro-api] Upgrade db version (PR #2466)",
              "message_id": "019a3575-3541-7c31-9857-5dfea488c4c6",
              "entity_id": "019a3575-3540-7231-8b83-51279a1bf623",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "## Summary\nAWS auto updated our dbs from 16.3 to 16.8. Updating pulumi to reflect this.\n## Screenshots, GIFs, and Videos\n## Checklist\n* Included (`MACRO-N`) in the PR title.\n* QA'd\nTests for PR (pick one):\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://github.com/macro-inc/macro-api/pull/2466\n#### Commit Summary\n* 452175c Upgrade db version\n#### File Changes\n(1 file)\n* **M** cloud-storage/infra/packages/resources/src/resources/rds.ts (2)\n#### Patch Links:\n* https://github.com/macro-inc/macro-api/pull/2466.patch\n* https://github.com/macro-inc/macro-api/pull/2466.diff\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2466@github.com>",
              "labels": [
                "github",
                "CATEGORY_UPDATES",
                "UNREAD"
              ],
              "sent_at": 1761833460,
              "thread_id": "019a3575-3540-7231-8b83-51279a1bf623",
              "updated_at": 1761833465,
              "sent_at_seconds": 1761833460,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761833465,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                ":\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://<macro_em>github.com</macro_em>",
                "* **M** cloud-storage/infra/packages/resources/src/resources/rds.ts (2)\n#### Patch Links:\n* https://<macro_em>github.com</macro_em>",
                "/macro-inc/macro-api/pull/2466.patch\n* https://<macro_em>github.com</macro_em>/macro-inc/macro-api/pull/2466.diff\n—\nReply",
                "to this email directly, view it on <macro_em>GitHub</macro_em>, or unsubscribe.",
                "You are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2466@<macro_em>github.com</macro_em>"
              ]
            }
          },
          {
            "_index": "emails",
            "_id": "019a30ae-2a24-78b3-9eef-e3aa7594a1e4:019a30b1-c647-7949-8be2-1ef3f2195790",
            "_score": 17.033447,
            "_source": {
              "cc": [
                "hutch@macro.com",
                "review_requested@noreply.github.com"
              ],
              "bcc": [],
              "subject": "[macro-inc/macro-api] seanaye/add/conn gateway pg frecency (PR #2457)",
              "message_id": "019a30b1-c647-7949-8be2-1ef3f2195790",
              "entity_id": "019a30ae-2a24-78b3-9eef-e3aa7594a1e4",
              "link_id": "01976c0a-7554-719c-a2fc-d4dcf7e8a8bf",
              "content": "## Summary\nThis PR swaps the backing storage layer for frecency in connection gateway from dynamo -> pg\n* **add inbound poller worker**\n* **switch connection gateway to pg frecency**\n* **use secret macro_db connection string**\n## Screenshots, GIFs, and Videos\n## Checklist\n* Included (`MACRO-N`) in the PR title.\n* QA'd\nTests for PR (pick one):\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://github.com/macro-inc/macro-api/pull/2457\n#### Commit Summary\n* 1575c1b add inbound poller worker\n* b51c9a4 switch connection gateway to pg frecency\n* 3c44249 use secret macro_db connection string\n#### File Changes\n(14 files)\n* **M** .github/CODEOWNERS (2)\n* **M** cloud-storage/Cargo.lock (1)\n* **M** cloud-storage/connection_gateway/Cargo.toml (3)\n* **M** cloud-storage/connection_gateway/src/context.rs (9)\n* **M** cloud-storage/connection_gateway/src/main.rs (33)\n* **M** cloud-storage/frecency/Cargo.toml (11)\n* **M** cloud-storage/frecency/src/domain/models.rs (20)\n* **M** cloud-storage/frecency/src/domain/ports.rs (6)\n* **M** cloud-storage/frecency/src/domain/services.rs (39)\n* **M** cloud-storage/frecency/src/inbound.rs (2)\n* **M** cloud-storage/frecency/src/inbound/polling_aggregator.rs (91)\n* **M** cloud-storage/frecency/src/outbound/postgres.rs (3)\n* **M** cloud-storage/infra/stacks/connection-gateway/index.ts (12)\n* **M** cloud-storage/remote_env_var/src/lib.rs (16)\n#### Patch Links:\n* https://github.com/macro-inc/macro-api/pull/2457.patch\n* https://github.com/macro-inc/macro-api/pull/2457.diff\n—\nReply to this email directly, view it on GitHub, or unsubscribe.\nYou are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2457@github.com>",
              "labels": [
                "github",
                "CATEGORY_PERSONAL",
                "UNREAD",
                "IMPORTANT"
              ],
              "sent_at": 1761753544,
              "thread_id": "019a30ae-2a24-78b3-9eef-e3aa7594a1e4",
              "updated_at": 1761753548,
              "sent_at_seconds": 1761753544,
              "sender": "notifications@github.com",
              "user_id": "macro|hutch@macro.com",
              "updated_at_seconds": 1761753548,
              "recipients": [
                "macro-api@noreply.github.com"
              ]
            },
            "highlight": {
              "content": [
                ":\n* N/A\n* 🤖 Automated\n#### You can view, comment on, or merge this pull request online at:\nhttps://<macro_em>github.com</macro_em>",
                "to pg frecency\n* 3c44249 use secret macro_db connection string\n#### File Changes\n(14 files)\n* **M** .<macro_em>github</macro_em>",
                "connection-gateway/index.ts (12)\n* **M** cloud-storage/remote_env_var/src/lib.rs (16)\n#### Patch Links:\n* https://<macro_em>github.com</macro_em>",
                "/macro-inc/macro-api/pull/2457.patch\n* https://<macro_em>github.com</macro_em>/macro-inc/macro-api/pull/2457.diff\n—\nReply",
                "to this email directly, view it on <macro_em>GitHub</macro_em>, or unsubscribe.",
                "You are receiving this because your review was requested.Message ID: <macro-inc/macro-api/pull/2457@<macro_em>github.com</macro_em>"
              ]
            }
          }
        ]
      }
    });

    let _: DefaultSearchResponse<UnifiedSearchIndex> = serde_json::from_value(json)?;

    Ok(())
}

#[test]
fn test_build_unified_search_request_content() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        search_indices: vec![
            SearchEntityType::Documents,
            SearchEntityType::Emails,
            SearchEntityType::Projects,
            SearchEntityType::Channels,
            SearchEntityType::Chats,
        ]
        .into_iter()
        .collect(),
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::Content,
        collapse: true,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
    };

    let result = build_unified_search_request(&unified_search_args)?;

    let expected = serde_json::json!({
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
          "content": {
            "number_of_fragments": 500,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          }
        },
        "require_field_match": true
      },
      "query": {
        "bool": {
          "minimum_should_match": 1,
          "should": [
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "documents"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "owner_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "terms": {
                      "link_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "emails"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "terms": {
                      "thread_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "mentions": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "sender_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "channels"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "chats"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "projects"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_name() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        search_indices: vec![
            SearchEntityType::Documents,
            SearchEntityType::Emails,
            SearchEntityType::Projects,
            SearchEntityType::Channels,
            SearchEntityType::Chats,
        ]
        .into_iter()
        .collect(),
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::Name,
        collapse: true,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
    };

    let result = build_unified_search_request(&unified_search_args)?;

    let expected = serde_json::json!({
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
            "document_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "subject": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "title": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "channel_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "project_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            }
        },
        "require_field_match": true
      },
      "query": {
        "bool": {
          "minimum_should_match": 1,
          "should": [
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "document_name": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "documents"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "owner_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "subject": "test"
                    }
                  },
                  {
                    "terms": {
                      "link_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "emails"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "channel_name": "test"
                    }
                  },
                  {
                    "terms": {
                      "thread_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "mentions": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "sender_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "channels"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "title": "test"
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "chats"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "project_name": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "projects"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_name_content() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        search_indices: vec![
            SearchEntityType::Documents,
            SearchEntityType::Emails,
            SearchEntityType::Projects,
            SearchEntityType::Channels,
            SearchEntityType::Chats,
        ]
        .into_iter()
        .collect(),
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::NameContent,
        collapse: true,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
    };

    let result = build_unified_search_request(&unified_search_args)?;

    let expected = serde_json::json!(
    {
      "aggs": {
        "total_uniques": {
          "cardinality": {
            "field": "entity_id"
          }
        }
      },
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
          "channel_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "content": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "document_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "project_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "subject": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "title": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          }
        },
        "require_field_match": false
      },
      "query": {
        "function_score": {
          "boost_mode": "multiply",
          "functions": [
            {
              "gauss": {
                "updated_at_seconds": {
                  "decay": 0.5,
                  "offset": "3d",
                  "origin": "now",
                  "scale": "21d"
                }
              },
              "weight": 1.3
            }
          ],
          "query": {
            "bool": {
              "minimum_should_match": 1,
              "should": [
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "document_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "document_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "documents"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "owner_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "subject": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "subject": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "terms": {
                          "link_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "sender": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "sender": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "cc": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "cc": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "bcc": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "bcc": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "recipients": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "recipients": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "emails"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "channel_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "channel_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "terms": {
                          "thread_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "terms": {
                          "mentions": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "terms": {
                          "sender_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "channels"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "title": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "title": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "role": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "role": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "chats"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "project_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "project_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "projects"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          },
          "score_mode": "multiply"
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ],
      "track_total_hits": true
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_single_index() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        search_indices: vec![SearchEntityType::Documents].into_iter().collect(),
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::Content,
        collapse: true,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
            ids_only: false,
        },
        ..Default::default()
    };

    let result = build_unified_search_request(&unified_search_args)?;
    let expected = serde_json::json!({
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
          "content": {
            "number_of_fragments": 500,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          }
        },
        "require_field_match": true
      },
      "query": {
        "bool": {
          "minimum_should_match": 1,
          "should": [
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "documents"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "owner_id": "user"
                    }
                  }
                ]
              }
            },
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_empty_indices() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        search_indices: vec![].into_iter().collect(),
        ..Default::default()
    };

    let err = build_unified_search_request(&unified_search_args).unwrap_err();

    assert_eq!(err, OpensearchClientError::EmptySearchIndices);

    Ok(())
}
