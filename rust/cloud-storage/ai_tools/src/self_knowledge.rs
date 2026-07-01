use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

/// The "about Macro" page returned by [`SelfKnowledge`].
///
/// Modeled on the Claude Code self-knowledge skill: rather than baking a large
/// product description into the system prompt, the model calls this tool to pull
/// in an overview plus a routing map into the live docs at docs.macro.com. Every
/// docs page is also served as plain Markdown (append `.md` to its URL), so the
/// model can read any page with the WebFetch tool — no special docs integration
/// is needed.
static ABOUT_MACRO: &str = r##"# About Macro

Macro is a single, fast workspace that unifies the tools a team uses to get work
done — email, messaging, tasks, documents, and more — into one linked database.
Everything can reference everything else: a task can link to an email, a doc can
@mention a channel message, and so on. The backend is Rust and the frontend is
Solid, so it is built for speed.

## What's in Macro

Macro is organized into "blocks":

- **Email** — email, integrated directly into the workspace.
- **Channels** — Slack-like messaging channels; the default way people communicate.
- **Chat** — AI conversations (this is what "chat" refers to).
- **Tasks** — task and project tracking.
- **Docs** — collaborative documents.
- **Canvas** — a freeform visual canvas.
- **Calls** — calls and call records.
- **CRM** — customer relationship management.
- **Folders** — file storage.
- **Agents** — AI agents that can act across the workspace.

Cross-cutting concepts: the **Unified Inbox** (recent items across every block,
read via the ListEntities tool), **Unified Search**, **Unified Memory**,
bidirectional **@mentions / linking**, and **permissions** that inherit from
channels.

## Core principles — read before answering questions about Macro

1. **Accuracy over guessing.** Your training data may be outdated or wrong about
   Macro. When a user asks what Macro is, what a feature does, or how to do
   something in Macro, treat the official docs as the source of truth.
2. **Read the docs.** Macro's docs are published at docs.macro.com. Every page is
   also served as plain Markdown — append `.md` to the page URL — so you can read
   it with the WebFetch tool.
3. **Cite the docs.** Link the user to the specific docs page you used.

## How to find the right page

- **Full index of every page:** https://docs.macro.com/llms.txt — fetch this
  first when you are unsure which page covers the question, then open the page it
  points to.
- Any page is readable as Markdown by appending `.md`, e.g.
  https://docs.macro.com/product/tasks.md

### Quick links (all readable as Markdown with a trailing `.md`)

- Get started: https://docs.macro.com/getting-started.md
- Products (https://docs.macro.com/product/<name>.md): email, channels, tasks,
  docs, canvas, calls, crm, folders, agents, inbox, search, snippets,
  unified-memory
- Concepts (https://docs.macro.com/concepts/<name>.md): blocks, mentions,
  properties
- AI & MCP: https://docs.macro.com/AI/mcp/overview.md ·
  tool reference https://docs.macro.com/AI/mcp/tools/index.md ·
  recipes https://docs.macro.com/AI/recipes.md
- Account: https://docs.macro.com/account/billing.md ·
  https://docs.macro.com/account/teams.md
- Other (https://docs.macro.com/<name>.md): permissions, keyboard-shortcuts,
  faq, switch-to-macro, apps, support, integrations/github
- Changelog: https://docs.macro.com/changelog/introduction.md

## Workflow for "what is Macro / how do I…" questions

1. Identify what the user is asking about (a block, a concept, billing, etc.).
2. Fetch the relevant docs.macro.com `.md` page with WebFetch (or llms.txt first
   if you are unsure which page to read).
3. Answer concisely, grounded in the docs, and link the page you used.
4. If you are still uncertain, point the user to the docs: "For the most current
   details, see <URL>.""##;

/// `selfKnowledge` returns an overview of Macro plus a routing map into the live
/// docs at docs.macro.com. It takes no arguments and does no I/O — it hands the
/// model a curated about-page so it can answer "what is Macro / how do I…"
/// questions accurately instead of guessing from stale training data, and then
/// read specific docs pages with WebFetch for detail.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "SelfKnowledge",
    description = "\
Learn what Macro is and how it works. Call this whenever the user asks an open-ended \
question about Macro itself — what it is, what it's for, what it can do, or how to do \
something in Macro — instead of answering from memory (your training data may be stale). \
Takes no arguments. Returns an overview of Macro and a map of links into the official \
docs at docs.macro.com; every docs page is readable as Markdown (append `.md` to its URL), \
so follow up with WebFetch on the relevant page for details and cite it."
)]
pub struct SelfKnowledge {}

/// The response for the [`SelfKnowledge`] tool: a single Markdown about-page.
#[derive(Debug, Serialize, JsonSchema)]
pub struct SelfKnowledgeResponse {
    /// An overview of Macro and a routing map into the docs at docs.macro.com.
    pub about: String,
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for SelfKnowledge {
    type Output = SelfKnowledgeResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(SelfKnowledgeResponse {
            about: ABOUT_MACRO.to_string(),
        })
    }
}
