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

/// Every session is a generation session, or none is.
struct Scopes(Option<SessionScope>);

#[async_trait]
impl SessionScopes for Scopes {
    async fn scope(&self, _: uuid::Uuid) -> Result<Option<SessionScope>, rootcause::Report> {
        Ok(self.0)
    }
}

/// Lets everything run.
struct Open;

impl NativeToolGate for Open {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { NativeToolVerdict::Run })
    }
}

/// A generation session's native tools are code mode's and finding tools
/// only; any other session's go to the owner's gate as before.
#[tokio::test]
async fn a_generation_session_uses_only_code_and_finding_tools() {
    let gate = |scope| ScopedToolGate {
        inner: Arc::new(Open),
        scopes: Arc::new(Scopes(scope)),
    };
    let session = AgentSessionId::new();
    let args = serde_json::json!({});
    let generation = gate(Some(SessionScope::Generation));
    for tool in [
        "ExecuteCode",
        "DescribeCodeTools",
        "ReadCodeDocs",
        "SearchTools",
        "LoadTools",
    ] {
        assert_eq!(
            generation.check(session, tool, &args).await,
            NativeToolVerdict::Run,
            "{tool}"
        );
    }
    for tool in [
        "SendConfirmedEmail",
        "SendChannelMessage",
        "CreateMemory",
        "WebFetch",
        "Subagent",
    ] {
        assert!(
            matches!(
                generation.check(session, tool, &args).await,
                NativeToolVerdict::Refuse(_)
            ),
            "{tool}"
        );
    }
    assert_eq!(
        gate(None).check(session, "SendConfirmedEmail", &args).await,
        NativeToolVerdict::Run
    );
}

/// The scope's list of POST reads covers every read the SDK sends as a POST,
/// and the only writes it lets a generation session make are its own tools
/// and creating an email draft.
#[test]
fn the_generation_scope_matches_the_sdk_catalog() {
    let concrete = |path: &str| {
        path.split('/')
            .map(|segment| {
                if segment.starts_with('{') {
                    "x"
                } else {
                    segment
                }
            })
            .collect::<Vec<_>>()
            .join("/")
    };
    let intended = [
        "scheduled-action.addSuggestion",
        "scheduled-action.rewriteSuggestion",
        "scheduled-action.retireSuggestion",
        "scheduled-action.attachSuggestionDraft",
        "scheduled-action.suggestRoutine",
        "scheduled-action.retireRoutineSuggestion",
        "email.createDraft",
        "cognition.structuredCompletion",
    ];
    let scope = SessionScope::Generation;
    for (key, operation) in code_execution::domain::operations() {
        let allowed = scope.allows(&operation.method, &concrete(&operation.path));
        if !operation.write {
            assert!(
                allowed,
                "the read {key} ({} {}) is refused",
                operation.method, operation.path
            );
        } else {
            assert_eq!(
                allowed,
                intended.contains(&key.as_str()),
                "{key} ({} {})",
                operation.method,
                operation.path
            );
        }
    }
}
