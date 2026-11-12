use super::*;
use crate::{CHAT_CODE_MODE_DROPPED_TOOLS, CHAT_CODE_MODE_TOOLS};
use std::collections::BTreeSet;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("chat@example.com").unwrap()
}

fn rollout(on: bool) -> ConnectRollout {
    Arc::new(move |_| Box::pin(async move { on }))
}

fn names(tools: &ChatTools) -> BTreeSet<String> {
    tools.toolset.tools.keys().cloned().collect()
}

fn direct_names() -> BTreeSet<String> {
    tools_for(AiHost::Chat)
        .toolset
        .tools
        .keys()
        .cloned()
        .collect()
}

#[tokio::test]
async fn flag_off_unset_or_without_a_runner_keeps_the_direct_chat_tools() {
    let direct = direct_names();
    let direct_prompt = tools_for(AiHost::Chat).prompt.to_string();
    for (label, toolsets) in [
        ("flag off", ChatToolsets::new(Some(rollout(false)), true)),
        ("no flag client", ChatToolsets::new(None, true)),
        (
            "no code runner",
            ChatToolsets::new(Some(rollout(true)), false),
        ),
    ] {
        let tools = toolsets.for_user(&user()).await;
        assert_eq!(names(&tools), direct, "{label}");
        assert_eq!(&*tools.prompt, direct_prompt, "{label}");
        for name in CHAT_CODE_MODE_TOOLS {
            assert!(!names(&tools).contains(name), "{label}: {name}");
        }
    }
    // The direct chat keeps the tools code mode drops.
    for name in CHAT_CODE_MODE_DROPPED_TOOLS {
        assert!(direct.contains(name), "{name}");
    }
}

#[tokio::test]
async fn flag_on_runs_chat_in_code_mode() {
    let tools = ChatToolsets::new(Some(rollout(true)), true)
        .for_user(&user())
        .await;
    let advertised = names(&tools);

    for name in CHAT_CODE_MODE_TOOLS {
        assert!(advertised.contains(name), "{name}");
    }
    for name in CHAT_CODE_MODE_DROPPED_TOOLS {
        assert!(!advertised.contains(name), "{name}");
    }
    let toolset = tools_for(AiHost::Chat).toolset;
    for name in &advertised {
        let user_tool = toolset.user_tools.contains_key(name);
        assert!(
            !agent_code_mode::domain::covered_by_code_sdk(name, user_tool),
            "{name} is covered by the SDK"
        );
    }
    // The composer still confirms chat's user tools, and chat still presents views.
    for name in ["SendEmail", "CreateCalendarEvent", "DisplayResults"] {
        assert!(advertised.contains(name), "{name}");
    }
    for covered in ["ReadContent", "ListEntities", "WebFetch"] {
        assert!(!advertised.contains(covered), "{covered}");
    }

    let prompt = &*tools.prompt;
    assert!(prompt.contains("ExecuteCode"));
    assert!(prompt.contains("AboutMacro"));
    assert!(prompt.contains("DisplayResults"));
    assert!(!prompt.contains("SelfKnowledge"));
    assert!(prompt.contains("present them with `DisplayResults` without being asked"));
}

#[test]
fn chat_code_mode_sends_the_code_tools_with_every_request() {
    let tools = tools_for_chat_code_mode();
    for name in CHAT_CODE_MODE_TOOLS {
        assert!(
            !tools.deferred.iter().any(|tool| tool.name == name),
            "{name}"
        );
    }
}
