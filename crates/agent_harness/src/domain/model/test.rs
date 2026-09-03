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
fn editable_personas_default_to_prompt_even_on_builtin_runtimes() {
    for kind in [
        AgentKind::InMemory,
        AgentKind::Cursor,
        AgentKind::SandboxedCoder,
        AgentKind::External,
    ] {
        for harness_allows_bypass in [None, Some(false), Some(true)] {
            assert_eq!(
                PermissionPolicyConfig::Persona {
                    kind,
                    harness_allows_bypass,
                    auto_accept_permissions: None,
                }
                .resolve(),
                PermissionPolicy::Prompt
            );
        }
    }
}

#[test]
fn registered_harness_limit_wins_over_runtime_kind_and_persona_choice() {
    for kind in [
        AgentKind::InMemory,
        AgentKind::Cursor,
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
