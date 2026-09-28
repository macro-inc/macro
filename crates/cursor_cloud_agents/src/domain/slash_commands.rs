//! Slash commands this agent advertises over ACP.
//!
//! Cursor's Cloud Agents API has a models list (`GET /v1/models`) and no
//! skills list. The website catalog (`cursor.com/api/dashboard/get-managed-skills`)
//! is cookie-authenticated and not callable with the `crsr_…` key this crate
//! holds. The commands here are the cloud-usable subset of that catalog:
//! skills Cursor's cloud runtime actually honors when `/name` arrives as
//! ordinary prompt text.
//!
//! IDE-only, CLI-only, and local-only skills (`rename-chat`, `statusline`,
//! `clone`, …) stay out. A name that is not in this table is still valid
//! prompt text; it is just not offered in the client's `/` menu.

#[cfg(test)]
mod test;

use agent_client_protocol::schema::v1::{
    AvailableCommand, AvailableCommandInput, UnstructuredCommandInput,
};

/// One curated command: a name, a description, and an optional input hint.
struct CatalogEntry {
    name: &'static str,
    description: &'static str,
    input_hint: Option<&'static str>,
}

/// Cloud-usable Cursor skills, in the order the `/` menu should list them.
///
/// Descriptions are the short catalog copy from Cursor's managed-skills list,
/// not the full `SKILL.md` bodies. Hints match the skills that parse leftover
/// text (`/goal <objective>`, `/loop [interval] <prompt>`, `/shell <command>`).
const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "autopilot",
        description: "Keep a PR merge-ready by triaging comments, resolving conflicts, and fixing CI.",
        input_hint: None,
    },
    CatalogEntry {
        name: "canvas",
        description: "Create a durable standalone canvas artifact beside the chat.",
        input_hint: None,
    },
    CatalogEntry {
        name: "create-hook",
        description: "Create Cursor hooks for agent lifecycle events.",
        input_hint: None,
    },
    CatalogEntry {
        name: "create-rule",
        description: "Create Cursor rules for persistent AI guidance.",
        input_hint: None,
    },
    CatalogEntry {
        name: "create-skill",
        description: "Create a Cursor Agent Skill (SKILL.md).",
        input_hint: None,
    },
    CatalogEntry {
        name: "create-subagent",
        description: "Create a custom subagent with a focused system prompt.",
        input_hint: None,
    },
    CatalogEntry {
        name: "deploy-with-vercel",
        description: "Link this repository to Vercel and deploy it.",
        input_hint: None,
    },
    CatalogEntry {
        name: "env-setup",
        description: "Explain, inspect, or improve a Cloud Agent environment.",
        input_hint: None,
    },
    CatalogEntry {
        name: "goal",
        description: "Set a goal that Cursor will pursue to completion.",
        input_hint: Some("<objective>"),
    },
    CatalogEntry {
        name: "loop",
        description: "Run a prompt or skill on a recurring interval.",
        input_hint: Some("[interval] <prompt>"),
    },
    CatalogEntry {
        name: "migrate-to-builds",
        description: "Test that a Cloud Agent environment works with prebuilt builds.",
        input_hint: None,
    },
    CatalogEntry {
        name: "migrate-to-skills",
        description: "Convert Cursor rules and slash commands to Agent Skills.",
        input_hint: None,
    },
    CatalogEntry {
        name: "review",
        description: "Review code changes with Bugbot or Security Review.",
        input_hint: None,
    },
    CatalogEntry {
        name: "review-bugbot",
        description: "Review code changes with the Bugbot subagent.",
        input_hint: None,
    },
    CatalogEntry {
        name: "review-security",
        description: "Review code changes with the Security Review subagent.",
        input_hint: None,
    },
    CatalogEntry {
        name: "sdk",
        description: "Guide integrations on the Cursor TypeScript or Python SDK.",
        input_hint: None,
    },
    CatalogEntry {
        name: "shell",
        description: "Run the rest of the prompt as a literal shell command.",
        input_hint: Some("<command>"),
    },
    CatalogEntry {
        name: "split-to-prs",
        description: "Split current work into small reviewable PRs.",
        input_hint: None,
    },
    CatalogEntry {
        name: "subscribe",
        description: "Wait for GitHub, Origin, Slack, or Linear events instead of polling.",
        input_hint: None,
    },
    CatalogEntry {
        name: "walkthrough-artifacts",
        description: "Create walkthrough screenshots and recordings of working changes.",
        input_hint: None,
    },
];

/// The slash commands this agent advertises on `session/new` and `session/load`.
#[must_use]
pub fn cursor_slash_commands() -> Vec<AvailableCommand> {
    CATALOG.iter().map(catalog_command).collect()
}

fn catalog_command(entry: &CatalogEntry) -> AvailableCommand {
    let command = AvailableCommand::new(entry.name, entry.description);
    match entry.input_hint {
        Some(hint) => command.input(AvailableCommandInput::Unstructured(
            UnstructuredCommandInput::new(hint),
        )),
        None => command,
    }
}
