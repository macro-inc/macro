use super::*;
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::testing::test_agent_session;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

const TURN: macro_uuid::Uuid = macro_uuid::Uuid::from_u128(5);

fn identity() -> ExecutionIdentity {
    let session = test_agent_session(AgentSessionId::new());
    ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: session.bot_id,
        owner: session.owner_user().unwrap().clone(),
        turn: TURN,
        lifetime: agent_code_mode::domain::RunLifetime::Foreground,
    }
}

fn prompter(kind: PrompterKind, user: Option<MacroUserIdStr<'static>>) -> TurnPrompter {
    TurnPrompter {
        kind,
        action_id: AgentActionId::from_uuid(TURN),
        user,
        client: None,
    }
}

/// A job never asks for an approval after its turn, so only a turn its owner
/// prompted, still running, in a session someone watches, may detach one.
#[test]
fn only_the_owners_own_running_turn_may_detach_a_job() {
    let identity = identity();
    let owner = Some(identity.owner.clone());
    let owner_turn = prompter(PrompterKind::User, owner.clone());
    assert_eq!(refusal(false, Some(&owner_turn), &identity), None);

    let teammate = MacroUserIdStr::parse_from_str("macro|teammate@example.com")
        .unwrap()
        .into_owned();
    assert_eq!(
        refusal(
            false,
            Some(&prompter(PrompterKind::User, Some(teammate))),
            &identity
        ),
        Some(NOT_OWNER)
    );
    assert_eq!(
        refusal(
            false,
            Some(&prompter(PrompterKind::System, None)),
            &identity
        ),
        Some(NOT_OWNER)
    );
    assert_eq!(
        refusal(
            false,
            Some(&prompter(PrompterKind::Program, owner.clone())),
            &identity
        ),
        Some(NOT_OWNER)
    );
    assert_eq!(refusal(false, None, &identity), Some(STALE_TURN));
    let mut later = owner_turn.clone();
    later.action_id = AgentActionId::mint();
    assert_eq!(refusal(false, Some(&later), &identity), Some(STALE_TURN));
    assert_eq!(
        refusal(true, Some(&owner_turn), &identity),
        Some(UNATTENDED)
    );
}
