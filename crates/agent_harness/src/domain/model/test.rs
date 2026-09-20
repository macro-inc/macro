use super::*;

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
        AgentKind::ClaudeCloud,
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
        AgentKind::ClaudeCloud,
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
        AgentKind::ClaudeCloud,
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
