use std::sync::Mutex;

use agent_egress::domain::approval::{ApprovalAnswer, ToolApproval, ToolApprovalAnswers};
use agent_egress::outbound::tool_approvals::{
    InMemoryToolApprovalStore, InProcessToolApprovalSignals,
};
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use agent_session::domain::model::TurnPrompter;
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[derive(Clone, Default)]
struct Heard {
    requested: Arc<tokio::sync::Notify>,
    statuses: Arc<Mutex<Vec<ToolApprovalStatus>>>,
}

impl ToolApprovalAnnouncer for Heard {
    async fn requested(&self, approval: &ToolApproval, _owner: &MacroUserIdStr<'static>) {
        self.statuses.lock().unwrap().push(approval.status);
        self.requested.notify_one();
    }

    async fn resolved(&self, approval: &ToolApproval) {
        self.statuses.lock().unwrap().push(approval.status);
    }
}

type Approvals =
    ToolApprovalService<InMemoryToolApprovalStore, InProcessToolApprovalSignals, Heard>;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

struct Rig {
    gate: OwnerApprovalGate<
        InMemoryAgentSessionRepo,
        InMemoryToolApprovalStore,
        InProcessToolApprovalSignals,
        Heard,
    >,
    sessions: InMemoryAgentSessionRepo,
    approvals: Arc<Approvals>,
    store: InMemoryToolApprovalStore,
    heard: Heard,
    session: AgentSessionId,
}

fn rig() -> Rig {
    let sessions = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::new();
    sessions.insert_session(test_agent_session(session));
    let store = InMemoryToolApprovalStore::new();
    let heard = Heard::default();
    let approvals = Arc::new(ToolApprovalService::new(
        store.clone(),
        store.signals(),
        heard.clone(),
    ));
    Rig {
        gate: OwnerApprovalGate::new(sessions.clone(), Arc::clone(&approvals)),
        sessions,
        approvals,
        store,
        heard,
        session,
    }
}

async fn prompted_by(rig: &Rig, user: Option<MacroUserIdStr<'static>>) {
    rig.sessions
        .set_turn_prompter(
            rig.session,
            &TurnPrompter {
                kind: agent_session::domain::model::PrompterKind::User,
                action_id: AgentActionId::mint(),
                user,
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn the_owners_own_turn_runs_without_asking() {
    let rig = rig();
    prompted_by(&rig, Some(owner())).await;
    let verdict = rig
        .gate
        .check(
            rig.session,
            "ListEmails",
            &serde_json::json!({"acting_as":"owner"}),
        )
        .await;
    assert_eq!(verdict, NativeToolVerdict::RunAs(owner()));
    assert!(rig.store.all().is_empty());
}

#[tokio::test]
async fn somebody_elses_turn_runs_only_once_the_owner_approves() {
    let rig = rig();
    prompted_by(
        &rig,
        Some(MacroUserIdStr::try_from_email("asker@example.com").unwrap()),
    )
    .await;
    let arguments = serde_json::json!({ "limit": 3, "acting_as":"owner" });
    let check = rig.gate.check(rig.session, "ListEmails", &arguments);
    let answer = async {
        rig.heard.requested.notified().await;
        let held = rig.store.all().remove(0);
        assert_eq!(held.tool_name, "ListEmails");
        assert_eq!(held.server_slug, "macro");
        assert_eq!(
            held.arguments,
            serde_json::json!({ "limit": 3, "acting_as":"owner" })
        );
        rig.approvals
            .answer(rig.session, held.id, ApprovalAnswer::Approve, &owner())
            .await
            .unwrap();
    };
    let (verdict, ()) = tokio::join!(check, answer);
    assert_eq!(verdict, NativeToolVerdict::RunAs(owner()));
}

#[tokio::test]
async fn a_declined_call_is_refused_in_words_the_model_can_relay() {
    let rig = rig();
    prompted_by(&rig, None).await;
    let arguments = serde_json::json!({"acting_as":"owner"});
    let check = rig.gate.check(rig.session, "SendEmail", &arguments);
    let answer = async {
        rig.heard.requested.notified().await;
        let held = rig.store.all().remove(0);
        rig.approvals
            .answer(rig.session, held.id, ApprovalAnswer::Deny, &owner())
            .await
            .unwrap();
    };
    let (verdict, ()) = tokio::join!(check, answer);
    let NativeToolVerdict::Refuse(reason) = verdict else {
        panic!("a declined call does not run");
    };
    assert!(reason.starts_with("owner@example.com declined this call, so SendEmail did not run."));
}

#[tokio::test]
async fn a_public_web_search_runs_without_asking_even_for_somebody_else() {
    let rig = rig();
    prompted_by(&rig, None).await;
    let verdict = rig
        .gate
        .check(
            rig.session,
            "WebSearch",
            &serde_json::json!({"acting_as":"owner"}),
        )
        .await;
    assert_eq!(verdict, NativeToolVerdict::Run);
    assert!(rig.store.all().is_empty());
}

#[tokio::test]
async fn requester_access_runs_without_asking_the_session_owner() {
    let rig = rig();
    let asker = MacroUserIdStr::try_from_email("asker@example.com").unwrap();
    prompted_by(&rig, Some(asker.clone())).await;
    let verdict = rig
        .gate
        .check(
            rig.session,
            "ListEmails",
            &serde_json::json!({"acting_as":"requester"}),
        )
        .await;
    assert_eq!(verdict, NativeToolVerdict::RunAs(asker));
    assert!(rig.store.all().is_empty());
}

#[tokio::test]
async fn missing_actor_and_system_requester_are_refused_without_using_owner_access() {
    let rig = rig();
    prompted_by(&rig, Some(owner())).await;
    assert!(matches!(
        rig.gate
            .check(rig.session, "ListEmails", &serde_json::json!({}))
            .await,
        NativeToolVerdict::Refuse(_)
    ));
    rig.sessions
        .set_turn_prompter(
            rig.session,
            &TurnPrompter {
                kind: agent_session::domain::model::PrompterKind::System,
                action_id: AgentActionId::mint(),
                user: Some(owner()),
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        rig.gate
            .check(
                rig.session,
                "ListEmails",
                &serde_json::json!({"acting_as":"requester"})
            )
            .await,
        NativeToolVerdict::Refuse(_)
    ));
    assert!(rig.store.all().is_empty());
}

#[tokio::test]
async fn code_execution_cannot_resolve_the_requester_of_a_replacement_turn() {
    let rig = rig();
    prompted_by(&rig, Some(owner())).await;
    let old = rig
        .sessions
        .turn_prompter(rig.session)
        .await
        .unwrap()
        .unwrap();
    let requester = MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    prompted_by(&rig, Some(requester.clone())).await;
    let current = rig
        .sessions
        .turn_prompter(rig.session)
        .await
        .unwrap()
        .unwrap();
    for turn in [serde_json::Value::Null, serde_json::json!(old.action_id)] {
        let verdict = rig
            .gate
            .check(
                rig.session,
                "ExecuteCode",
                &serde_json::json!({
                    "acting_as": "requester", "turn_id": turn,
                }),
            )
            .await;
        assert!(matches!(verdict, NativeToolVerdict::Refuse(_)));
    }
    let verdict = rig
        .gate
        .check(
            rig.session,
            "ExecuteCode",
            &serde_json::json!({
                "acting_as": "requester", "turn_id": current.action_id,
            }),
        )
        .await;
    assert_eq!(verdict, NativeToolVerdict::RunAs(requester));
    assert!(rig.heard.statuses.lock().unwrap().is_empty());
}
