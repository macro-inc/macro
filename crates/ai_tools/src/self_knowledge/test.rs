use super::ABOUT_MACRO;

/// The section the model answers "how do I run Claude Code or Codex through
/// macrod?" from. A cached copy of an older docs page once taught the model a
/// webhook design that no longer exists; this page must give the current steps.
fn macrod_section() -> &'static str {
    let start = ABOUT_MACRO
        .find("## Running Claude Code or Codex through macrod")
        .expect("the about page has a macrod section");
    let rest = &ABOUT_MACRO[start..];
    let end = rest[3..].find("\n## ").map_or(rest.len(), |end| end + 3);
    &rest[..end]
}

#[test]
fn macrod_section_gives_the_current_setup_steps() {
    let section = macrod_section();
    for step in [
        "crates/coding_agent_worker/install/install.sh",
        "Run `macrod`",
        "**Quickstart**",
        "**Workspace**",
        "Claude Code in herdr",
        "Codex in herdr",
        "**Create and pair**",
        "**Settings → Machines → New machine**",
        "**Approve**",
        "**Settings → Agents**",
        "**Add agent**",
        "**On your machine** under **Where it runs**",
        "dials out to Macro",
        "On a cloud server",
        "https://macro.com/docs/AI/bring-your-own",
    ] {
        assert!(section.contains(step), "macrod section is missing {step:?}");
    }
}

#[test]
fn about_page_never_teaches_the_retired_webhook_setup() {
    for retired in [
        "macro-events",
        "8790",
        "bot_token",
        "bot_scope",
        "public_url",
        "available soon",
        "Make this bot a coding agent",
        "npx -y @agentclientprotocol",
        "macro.toml",
        "trycloudflare",
    ] {
        assert!(
            !ABOUT_MACRO.contains(retired),
            "about page mentions retired setup detail {retired:?}"
        );
    }
}

#[test]
fn about_page_reads_docs_from_the_canonical_host() {
    let stale_links: Vec<&str> = ABOUT_MACRO
        .split_whitespace()
        .filter(|word| word.contains("https://docs.macro.com"))
        .collect();
    assert!(
        stale_links.is_empty(),
        "docs.macro.com only redirects to macro.com/docs, and fetched copies of it are stale: {stale_links:?}"
    );
}
