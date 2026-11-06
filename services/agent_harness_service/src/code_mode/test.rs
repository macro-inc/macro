use super::*;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
struct Gate {
    verdict: NativeToolVerdict,
    calls: AtomicUsize,
}
impl NativeToolGate for Gate {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        name: &'a str,
        args: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        assert_eq!(name, "ExecuteCode");
        assert_eq!(args["source"], "fixture");
        assert_eq!(args["turn_id"], macro_uuid::Uuid::from_u128(1).to_string());
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.verdict.clone() })
    }
}
#[tokio::test]
async fn owner_approval_is_required_before_credentials_and_cancel_skips_gate() {
    let session = test_agent_session(AgentSessionId::new());
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: session.bot_id,
        owner: session.owner_user().unwrap().clone(),
        turn: macro_uuid::Uuid::from_u128(1),
    };
    let gate = Gate {
        verdict: NativeToolVerdict::Refuse("Owner declined".into()),
        calls: AtomicUsize::new(0),
    };
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new()).await,
        Err(CodeModeError::Invalid(_))
    ));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &cancel).await,
        Err(CodeModeError::Forbidden)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(session.owner_user().unwrap().clone()),
        calls: AtomicUsize::new(0),
    };
    assert!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn execution_credentials_use_the_gate_resolved_requester() {
    let session = test_agent_session(AgentSessionId::new());
    let requester =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Requester,
        session: session.id,
        owner: session.owner_user().unwrap().clone(),
        agent_id: session.bot_id,
        turn: macro_uuid::Uuid::from_u128(1),
    };
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(requester.clone()),
        calls: AtomicUsize::new(0),
    };
    assert_eq!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .unwrap(),
        requester
    );
}

#[test]
fn teammate_sdk_writes_as_itself_and_other_caller_attribution_stays_unchanged() {
    assert_eq!(
        super::execution_actor(&ai_toolset::ToolCaller::ApiKey, true),
        None
    );
    assert_eq!(
        super::execution_actor(&ai_toolset::ToolCaller::ApiKey, false),
        Some(bot_id::MACRO_AI_BOT_ID)
    );
    assert_eq!(
        super::execution_actor(
            &ai_toolset::ToolCaller::McpClient {
                name: Some("client".into())
            },
            true
        ),
        Some(bot_id::MACRO_AI_BOT_ID)
    );
    assert_eq!(
        super::execution_actor(&ai_toolset::ToolCaller::Agent(bot_id::BotId::TEST_A), true),
        Some(bot_id::BotId::TEST_A)
    );
}
