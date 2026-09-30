//! System skill for changing an agent's instructions and settings.

use prompt::StaticPrompt;

use crate::SystemSkill;

static TITLE: &str = "Configure Agent";

static INSTRUCTIONS: &str = r##"Follow this skill when the user asks to change how one of their agents behaves - its instructions or system prompt, the model or runtime it runs on, which channels it answers in, which connected apps its sessions get, whether it asks before using tools, or whether it is a coding or chat agent. Agents are the personas people `@` mention in channels and open sessions with; each has a bot profile plus this configuration.

## Find the agent

1. Call `ListAgents`. It returns every agent the user can manage with its current instructions and settings. Match the user's wording against `bot.name` and `bot.handle`; if more than one agent fits or none does, list the candidates and ask rather than guessing.
2. Keep the agent's `bot.botId` - every configuration call takes it.

## Change instructions

Instructions are replaced whole, not merged. To edit them:

1. Start from the current `instructions` text in the `ListAgents` result.
2. Apply exactly what the user asked - add, remove, or reword that part - and leave everything else intact, including formatting and headings.
3. For a substantial rewrite, or when the user's intent is ambiguous, show the proposed new text and confirm before applying. For a small, clearly specified edit, apply it and show what changed afterwards.
4. Call `ConfigureAgent` with `botId` and the complete new `instructions`.

Never send a fragment as the new instructions: it would erase the rest.

## Change settings

Pass only the fields that should change; `ConfigureAgent` keeps the others.

- **Runtime (`harness`)**: `in-memory` is Macro's built-in chat agent; `cursor` and `claude-cloud` run on the user's connected Cursor or Claude account; `macrod` is a self-hosted harness and needs `harnessId`. Model ids are runtime-specific, so when the runtime changes, ask which model to use unless the user named one, and pass `defaultModel` in the same call.
- **Model (`defaultModel`)**: pass the id as the runtime names it. If the user gives a family name ("Sonnet", "Opus"), confirm the exact id before applying.
- **Channels**: `channelScope: "all"` makes the agent mentionable everywhere the owner is; `channelIds` limits it to those channels - the complete list, and the user must belong to each. Resolve channel names to ids first.
- **Connected apps**: `mcpScope: "owner_connections"` gives sessions whatever apps the person running them has connected; `mcpServers` pins an exact list of Pipedream apps by `appSlug` and `serverName`.
- **Permissions (`autoAcceptPermissions`)**: `true` lets sessions approve tool permission requests without asking, `false` makes them ask. Self-hosted harnesses only honor `true` when their operator allows bypass; the tool reports the refusal.
- **Coding mode (`isCoding`)**: a coding agent works in a repository and answers a mention with a live session; a chat agent replies in the thread.

Profile changes - display name, handle, description, picture - go through `ConfigureBot` instead.

## Report

State what changed in one or two sentences, quoting the new instruction text or setting values. Mention that sessions already running keep the configuration they opened with; only new sessions pick up the change. If the tool refused the change, relay its reason and what would make it valid.
"##;

static INTENT: &str = "Requests to change an agent's behavior are resolved to one manageable agent, applied as a \
     whole-text instruction replacement or a minimal settings patch through ConfigureAgent, and \
     reported with what changed and that only new sessions see it.";

/// The skill's instructions as a composable prompt section.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);

/// The configure-agent system skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "configure-agent",
    name: "Configure Agent",
    content: &PROMPT,
};
