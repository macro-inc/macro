use super::*;
use agent_fold::domain::model::{
    AgentRequestId, ElicitationRequest, ElicitationRequestId, PendingElicitation,
    PendingPermission, PendingToolApproval, PermissionOption, PermissionOptionKind, ToolUseId,
};
use agent_fold::domain::model::{Author, FoldedMessage, MessagePart, ToolName, ToolStatus, TurnId};
use non_empty::NonEmpty;

fn candidate(state: UpdateTurnState, harness: &str, archived: bool) -> UpdateCandidate {
    UpdateCandidate {
        id: AgentSessionId::new(),
        name: "Fix login".into(),
        harness: harness.into(),
        pull_request_url: Some("https://github.com/example/repo/pull/1".into()),
        turn_state: state,
        is_archived: archived,
        last_activity: Utc::now() - Duration::minutes(21),
    }
}

struct Repo(Vec<UpdateCandidate>);

impl CodingAgentUpdatesRepo for Repo {
    async fn candidates(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<UpdateCandidate>, CodingAgentError> {
        Ok(self.0.clone())
    }
    async fn log(&self, _: AgentSessionId) -> Result<Vec<StoredAgentSessionLog>, CodingAgentError> {
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn stalled_excludes_archived_and_non_coding_sessions() {
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap();
    let result = list_updates(
        &Repo(vec![
            candidate(UpdateTurnState::Running, "cursor", false),
            candidate(UpdateTurnState::Running, "cursor", true),
            candidate(UpdateTurnState::Running, "in-memory", false),
        ]),
        owner,
    )
    .await
    .unwrap();
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].kind, AgentUpdateKind::Stalled);
    assert_eq!(result.items[0].session_name, "Fix login");
    assert_eq!(
        result.items[0].pull_request_url.as_deref(),
        Some("https://github.com/example/repo/pull/1")
    );
}

#[tokio::test]
async fn limits_session_work_and_explains_truncation() {
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap();
    let result = list_updates(
        &Repo(
            (0..26)
                .map(|_| candidate(UpdateTurnState::Running, "cursor", false))
                .collect(),
        ),
        owner,
    )
    .await
    .unwrap();
    assert_eq!(result.items.len(), 25);
    assert!(result.truncated);
    assert!(
        result
            .truncation_notice
            .as_deref()
            .unwrap()
            .contains("25 most recent")
    );
}

#[test]
fn pending_interaction_variants_keep_their_user_facing_details() {
    let session = candidate(UpdateTurnState::Blocked, "cursor", false);
    let transcript = FoldedMessage {
        id: TurnId(1),
        author: Author::Agent,
        request_id: None,
        parts: NonEmpty::new(vec![MessagePart::ToolUse {
            id: ToolUseId("tool-1".into()),
            name: ToolName::native("Bash"),
            status: ToolStatus::Pending,
            detail: ToolDetail::Terminal {
                command: Some("cargo test".into()),
                output: None,
                exit_code: None,
            },
        }])
        .unwrap(),
        stop: None,
        pending: false,
        posted_at: None,
    };
    let permission = pending_item(
        &session,
        &PendingInteraction::Permission(PendingPermission {
            request_id: AgentRequestId::Number(1),
            turn: 1,
            tool_call: ToolUseId("tool-1".into()),
            options: vec![PermissionOption {
                id: "allow".into(),
                name: "Allow once".into(),
                kind: PermissionOptionKind::AllowOnce,
            }],
        }),
        &[transcript],
        session.last_activity,
    );
    assert_eq!(permission.kind, AgentUpdateKind::Permission);
    assert_eq!(permission.summary, "Approve cargo test");
    assert_eq!(permission.options, ["Allow once"]);

    let elicitation = pending_item(
        &session,
        &PendingInteraction::Elicitation(PendingElicitation {
            request_id: ElicitationRequestId::Number(2),
            turn: 1,
            tool_call: None,
            message: "Which branch?".into(),
            request: ElicitationRequest::Unrecognized {
                mode: "other".into(),
                raw: serde_json::Value::Null,
            },
        }),
        &[],
        session.last_activity,
    );
    assert_eq!(elicitation.kind, AgentUpdateKind::Elicitation);
    assert_eq!(elicitation.summary, "Which branch?");

    let approval = pending_item(
        &session,
        &PendingInteraction::ToolApproval(PendingToolApproval {
            approval_id: "approval-1".into(),
            turn: 1,
            server_slug: "github".into(),
            server_name: "GitHub".into(),
            tool_name: "merge_pr".into(),
            requested_by: None,
        }),
        &[],
        session.last_activity,
    );
    assert_eq!(approval.kind, AgentUpdateKind::ToolApproval);
    assert_eq!(approval.summary, "Approve merge_pr on GitHub");
}
