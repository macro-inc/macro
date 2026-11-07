use super::*;
use bot_id::{CODEX_BOT_ID, CURSOR_BOT_ID};

#[test]
fn only_external_runtimes_prompt_by_default() {
    assert_eq!(
        AgentKind::External.default_permission_policy(),
        PermissionPolicy::Prompt
    );
    for managed in [
        AgentKind::SandboxedCoder,
        AgentKind::Cursor,
        AgentKind::CodexCloud,
        AgentKind::InMemory,
    ] {
        assert_eq!(
            managed.default_permission_policy(),
            PermissionPolicy::AutoAccept,
            "{managed:?} runs where approving on arrival is safe"
        );
    }
}

#[test]
fn bypass_requires_both_operator_opt_in_and_persona_choice() {
    for allowed in [false, true] {
        for choice in [None, Some(false), Some(true)] {
            let expected = if allowed && choice == Some(true) {
                PermissionPolicy::AutoAccept
            } else {
                PermissionPolicy::Prompt
            };
            assert_eq!(resolve_permission_policy(allowed, choice), expected);
        }
    }
}

#[test]
fn builtin_runtimes_always_bypass_regardless_of_saved_agent_choice() {
    for kind in [
        AgentKind::InMemory,
        AgentKind::Cursor,
        AgentKind::CodexCloud,
        AgentKind::SandboxedCoder,
    ] {
        for auto_accept_permissions in [None, Some(false), Some(true)] {
            assert_eq!(
                PermissionPolicyConfig::Persona {
                    kind,
                    harness_allows_bypass: None,
                    auto_accept_permissions,
                }
                .resolve(),
                PermissionPolicy::AutoAccept
            );
        }
    }
}

#[test]
fn external_runtimes_require_registered_harness_consent_and_agent_choice() {
    for harness_allows_bypass in [None, Some(false), Some(true)] {
        for auto_accept_permissions in [None, Some(false), Some(true)] {
            assert_eq!(
                PermissionPolicyConfig::Persona {
                    kind: AgentKind::External,
                    harness_allows_bypass,
                    auto_accept_permissions,
                }
                .resolve(),
                if harness_allows_bypass == Some(true) && auto_accept_permissions == Some(true) {
                    PermissionPolicy::AutoAccept
                } else {
                    PermissionPolicy::Prompt
                }
            );
        }
    }
}

#[test]
fn registered_harness_limit_wins_over_runtime_kind_and_persona_choice() {
    for kind in [
        AgentKind::InMemory,
        AgentKind::Cursor,
        AgentKind::CodexCloud,
        AgentKind::SandboxedCoder,
        AgentKind::External,
    ] {
        assert_eq!(
            PermissionPolicyConfig::Persona {
                kind,
                harness_allows_bypass: Some(false),
                auto_accept_permissions: Some(true),
            }
            .resolve(),
            PermissionPolicy::Prompt
        );
    }
}

#[test]
fn first_party_cloud_kinds_own_a_fixed_harness_slug() {
    assert_eq!(AgentKind::Cursor.harness_slug(), Some("cursor"));
    assert_eq!(AgentKind::CodexCloud.harness_slug(), Some("codex-cloud"));
    assert_eq!(AgentKind::SandboxedCoder.harness_slug(), None);
    assert_eq!(AgentKind::InMemory.harness_slug(), None);
    assert_eq!(AgentKind::External.harness_slug(), None);

    // A create-path fallback that stamped the sandboxed-coder default is
    // corrected from the bot, not from the wrong slug it was handed.
    for (bot, slug) in [(CURSOR_BOT_ID, "cursor"), (CODEX_BOT_ID, "codex-cloud")] {
        assert_eq!(
            AgentKind::for_session(bot, "opencode").harness_slug(),
            Some(slug),
            "{bot:?}"
        );
    }
}

/// The URL survives verbatim - it is what a session's row carries, and
/// what the egress proxy re-reads - and one that names no repository is
/// refused rather than repaired. The shapes themselves are the parser's
/// own tests, in `agent_egress`.
#[test]
fn a_session_repository_keeps_the_url_it_was_read_from() {
    let repository =
        SessionRepository::parse("https://github.com/macro-inc/macro.git").expect("a repo");
    assert_eq!(
        repository.as_str(),
        "https://github.com/macro-inc/macro.git"
    );

    for url in ["", "https://github.com/macro-inc", "not a url"] {
        assert_eq!(SessionRepository::parse(url), None, "accepted {url}");
    }
}

/// The in-memory runtime is the one that chats; everything else works in a
/// repository and is announced as a live chip.
#[test]
fn only_the_in_memory_runtime_is_not_a_coder() {
    assert!(!AgentKind::InMemory.is_coding());
    for coder in [
        AgentKind::SandboxedCoder,
        AgentKind::Cursor,
        AgentKind::CodexCloud,
        AgentKind::External,
    ] {
        assert!(coder.is_coding(), "{coder:?} has a repository to work in");
    }
}

/// The persona's choice wins; without one, the runtime's nature decides.
#[test]
fn a_persona_chooses_whether_it_codes_and_otherwise_follows_its_runtime() {
    for kind in [AgentKind::InMemory, AgentKind::External, AgentKind::Cursor] {
        assert!(is_coding_agent(Some(true), kind), "{kind:?}");
        assert!(!is_coding_agent(Some(false), kind), "{kind:?}");
        assert_eq!(is_coding_agent(None, kind), kind.is_coding(), "{kind:?}");
    }
}

#[test]
fn a_turn_with_text_answered_however_it_stopped() {
    for stop in [
        StopReason::EndTurn,
        StopReason::Cancelled,
        StopReason::Failed {
            message: "boom".to_owned(),
            notice: None,
        },
    ] {
        assert_eq!(
            ReplyOutcome::of_turn(&stop, Some("Here you go.".to_owned())),
            ReplyOutcome::Answered("Here you go.".to_owned()),
            "{stop:?}"
        );
    }
}

#[test]
fn a_silent_turn_is_told_by_how_it_stopped() {
    for (stop, expected) in [
        (StopReason::EndTurn, ReplyOutcome::Empty),
        (StopReason::MaxTokens, ReplyOutcome::Empty),
        (StopReason::Refusal, ReplyOutcome::Empty),
        (
            StopReason::Other {
                reason: "mystery".to_owned(),
            },
            ReplyOutcome::Empty,
        ),
        (StopReason::Cancelled, ReplyOutcome::Cancelled),
        (
            StopReason::Failed {
                message: "boom".to_owned(),
                notice: None,
            },
            ReplyOutcome::Failed,
        ),
    ] {
        assert_eq!(ReplyOutcome::of_turn(&stop, None), expected, "{stop:?}");
        assert_eq!(
            ReplyOutcome::of_turn(&stop, Some("  \n".to_owned())),
            expected,
            "blank text is no text: {stop:?}"
        );
    }
}

#[test]
fn a_resident_answers_anyone_while_its_owner_keeps_access() {
    let resident = |agent_owner_may_use, actor_may_use| RuntimeAccessFacts {
        runtime_name: "box".to_owned(),
        resident: true,
        agent_owner_may_use,
        actor_may_use,
    };
    assert!(resident(true, Some(false)).may_run());
    assert!(resident(true, None).may_run());
    assert!(!resident(false, Some(true)).may_run());
    assert!(!resident(false, None).may_run());
}

#[test]
fn a_coding_agent_runs_for_people_who_may_use_the_runtime_themselves() {
    let coding = |agent_owner_may_use, actor_may_use| RuntimeAccessFacts {
        runtime_name: "box".to_owned(),
        resident: false,
        agent_owner_may_use,
        actor_may_use,
    };
    assert!(coding(false, Some(true)).may_run());
    assert!(!coding(true, Some(false)).may_run());
    // A turn nobody prompted runs on its agent owner's authority.
    assert!(coding(true, None).may_run());
    assert!(!coding(false, None).may_run());
}

/// The prompter `command` decodes with, from a `Deliver` or `EditQueued`.
fn decoded_prompter(command: serde_json::Value) -> PrompterKind {
    match serde_json::from_value(command).unwrap() {
        HarnessCommand::Deliver(deliver) => deliver.prompter,
        HarnessCommand::EditQueued { prompter, .. } => prompter,
        other => panic!("decoded {other:?}"),
    }
}

/// A delivery naming a prompter this build doesn't know is a system turn's,
/// acting for nobody.
#[test]
fn a_delivery_with_an_unknown_prompter_reads_as_a_system_turns() {
    let command = serde_json::json!({"Deliver": {
        "id": AgentActionId::mint(),
        "action": AgentAction::prompt("approve the review"),
        "actor": "macro|owner@example.com",
        "announce": null,
        "prompter": "bogus",
    }});
    assert_eq!(decoded_prompter(command), PrompterKind::System);
}

/// A delivery from before the prompter was sent is a person's.
#[test]
fn a_delivery_without_a_prompter_reads_as_a_persons() {
    let command = serde_json::json!({"Deliver": {
        "id": AgentActionId::mint(),
        "action": AgentAction::prompt("approve the review"),
        "actor": "macro|owner@example.com",
        "announce": null,
    }});
    assert_eq!(decoded_prompter(command), PrompterKind::User);
}

/// An edit naming a prompter this build doesn't know is a system turn's.
#[test]
fn an_edit_with_an_unknown_prompter_reads_as_a_system_turns() {
    let command = serde_json::json!({"EditQueued": {
        "action_id": AgentActionId::mint(),
        "prompt": "approve the review",
        "actor": "macro|owner@example.com",
        "prompter": "bogus",
    }});
    assert_eq!(decoded_prompter(command), PrompterKind::System);
}

/// An edit from before the prompter was sent is a person's.
#[test]
fn an_edit_without_a_prompter_reads_as_a_persons() {
    let command = serde_json::json!({"EditQueued": {
        "action_id": AgentActionId::mint(),
        "prompt": "approve the review",
        "actor": "macro|owner@example.com",
    }});
    assert_eq!(decoded_prompter(command), PrompterKind::User);
}
