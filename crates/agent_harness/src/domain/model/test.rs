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
fn an_explicit_choice_beats_the_kind_default() {
    assert_eq!(
        resolve_permission_policy(AgentKind::External, Some(true)),
        PermissionPolicy::AutoAccept
    );
    assert_eq!(
        resolve_permission_policy(AgentKind::InMemory, Some(false)),
        PermissionPolicy::Prompt
    );
    assert_eq!(
        resolve_permission_policy(AgentKind::External, None),
        PermissionPolicy::Prompt
    );
    assert_eq!(
        resolve_permission_policy(AgentKind::Cursor, None),
        PermissionPolicy::AutoAccept
    );
}
