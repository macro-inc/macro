use super::*;

/// Where `text` calls the TypeScript SDK: `macro.<name>` (not the macro.com
/// domain), the `execution` handle, or a `main` module.
fn typescript_calls(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    for (index, _) in text.match_indices("macro.") {
        let rest = &text[index + "macro.".len()..];
        let starts_lowercase = rest.starts_with(|c: char| c.is_ascii_lowercase());
        if starts_lowercase && !rest.starts_with("com") {
            found.push(&text[index..(index + 30).min(text.len())]);
        }
    }
    for marker in [
        "execution.views",
        "execution.reviews",
        "export async function main",
        "@macro-inc/sdk",
        "webUrl()",
        "EmailDraft.",
        "EmailMessage.",
        "canvas.render",
        "toMarkdown()",
        "CodeContext",
        "for await",
        "SDK document-write",
    ] {
        if text.contains(marker) {
            found.push(marker);
        }
    }
    found
}

/// Where `text` calls a dialect operation, `tools.<service>.<operation>`.
fn dialect_calls(text: &str) -> Vec<&str> {
    text.match_indices("tools.")
        .filter(|(index, _)| {
            let before = text[..*index].chars().next_back();
            let after = text[index + "tools.".len()..].chars().next();
            !before.is_some_and(|c| c.is_ascii_alphanumeric())
                && after.is_some_and(|c| c.is_ascii_lowercase())
        })
        .map(|(index, _)| &text[index..(index + 30).min(text.len())])
        .collect()
}

#[test]
fn every_swapped_phrase_is_still_in_todays_prompt() {
    let base = SESSION_BASE_PROMPT.to_string();
    for (from, _) in BASE_SWAPS {
        assert!(base.contains(from), "{from}");
    }
    let user_tools = user_tools::CODE_MODE_SESSION_PROMPT.to_string();
    for (from, _) in USER_TOOLS_SWAPS {
        assert!(user_tools.contains(from), "{from}");
    }
    let agent_session = agent_session::PROMPT.to_string();
    for (from, _) in AGENT_SESSION_SWAPS {
        assert!(agent_session.contains(from), "{from}");
    }
}

#[test]
fn each_kind_of_prompt_teaches_only_its_own_code() {
    let dialect = format!("{}{}", session_tool_use_prompt(), agent_session_prompt());
    assert_eq!(typescript_calls(&dialect), Vec::<&str>::new());
    assert!(dialect.contains(&code_mode::DIALECT_PROMPT.to_string()));
    assert!(!dialect.contains(&code_mode::PROMPT.to_string()));
    assert!(dialect.contains("tools.agent_harness.present_session_view"));
    assert!(dialect.contains("search(\"create task\")"));

    let typescript = format!(
        "{}{}",
        crate::CODE_MODE_SESSION_TOOL_USE_PROMPT,
        agent_session::PROMPT
    );
    assert_eq!(dialect_calls(&typescript), Vec::<&str>::new());
    assert!(!typescript_calls(&typescript).is_empty());
}
