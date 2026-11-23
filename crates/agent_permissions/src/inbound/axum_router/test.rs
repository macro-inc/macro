use std::sync::Mutex;

use agent_permission_registry::Action;
use async_trait::async_trait;
use axum::body::{Body, to_bytes};
use axum::http::Request;
use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::ports::NoOpEntityAccessService;
use macro_authorization::{
    CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential,
    ValidatedIdentity,
};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::model::{
    OperationKey, PermissionState, ResolvedCall, SessionPolicy, ToolPermissionCatalog,
};

const USER: &str = "macro|router-test@example.com";

/// `person` is a person's own session, `agent` a code-mode token attributed
/// to `BotId::TEST_A`, `key` a user API key.
#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, _jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: USER.to_owned(),
            ..UserContext::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let (origin, agent_id) = match jwt {
            "person" => (CredentialOrigin::Session, None),
            "agent" => (CredentialOrigin::MacroApiJwt, Some(BotId::TEST_A)),
            "key" => (CredentialOrigin::UserApiKey, None),
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };
        Ok(ValidatedCredential {
            origin,
            identity: ValidatedIdentity {
                agent_id,
                agent_via: None,
                routine_id: None,
                user_id: USER.to_owned(),
                fusion_user_id: String::new(),
                organization_id: None,
                permissions: None,
            },
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Refuses every call with `error` and records who asked.
struct FakePermissions {
    error: fn() -> PermissionError,
    callers: Mutex<Vec<Credential>>,
}

impl FakePermissions {
    fn refuse(&self, caller: &Caller) -> PermissionError {
        self.callers.lock().unwrap().push(caller.credential.clone());
        (self.error)()
    }
}

#[async_trait]
impl AgentPermissions for FakePermissions {
    async fn catalog(&self, caller: &Caller) -> Result<ToolPermissionCatalog, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn view_agent(
        &self,
        caller: &Caller,
        _agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn view_session(
        &self,
        caller: &Caller,
        _session: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn set(
        &self,
        caller: &Caller,
        _agent: BotId,
        _changes: Vec<Change>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn tighten(
        &self,
        caller: &Caller,
        _agent: BotId,
        _changes: Vec<Change>,
    ) -> Result<Tightened, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn reset(
        &self,
        caller: &Caller,
        _agent: BotId,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn set_source(
        &self,
        caller: &Caller,
        _agent: BotId,
        _source: PolicyId,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn detach(
        &self,
        caller: &Caller,
        _agent: BotId,
        _changes: Option<Vec<Change>>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn source_candidates(
        &self,
        caller: &Caller,
        _of: CandidatesFor,
    ) -> Result<SourceCandidates, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn view_policy(
        &self,
        caller: &Caller,
        _policy: PolicyId,
    ) -> Result<PermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn view_team(
        &self,
        caller: &Caller,
        _team: Uuid,
    ) -> Result<TeamPermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn set_team(
        &self,
        caller: &Caller,
        _team: Uuid,
        _changes: Vec<Change>,
    ) -> Result<TeamPermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn reset_team(
        &self,
        caller: &Caller,
        _team: Uuid,
    ) -> Result<TeamPermissionsView, PermissionError> {
        Err(self.refuse(caller))
    }

    async fn resolve_calls(
        &self,
        _policy: &SessionPolicy,
        _calls: &[OperationKey],
    ) -> Result<Vec<ResolvedCall>, PermissionError> {
        Ok(vec![])
    }
}

fn app(permissions: Arc<FakePermissions>) -> Router {
    router(AgentPermissionsRouterState::new(
        permissions,
        Arc::new(NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    ))
}

async fn send(
    app: Router,
    method: &str,
    uri: &str,
    token: &str,
) -> (StatusCode, serde_json::Value) {
    let body = if uri.ends_with("/source") {
        Body::from(
            serde_json::json!({ "sourcePolicyId": "00000000-0000-0000-0000-00000000501c" })
                .to_string(),
        )
    } else if method == "PUT" || method == "POST" {
        Body::from(
            serde_json::json!({
                "changes": [{
                    "target": { "kind": "group_action", "group": "email", "action": "send" },
                    "state": "never",
                }],
            })
            .to_string(),
        )
    } else {
        Body::empty()
    };
    let response = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

const AGENT_ROUTES: [(&str, &str); 13] = [
    ("GET", "/agent-tool-permissions/catalog"),
    (
        "GET",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions",
    ),
    (
        "PUT",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions",
    ),
    (
        "POST",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions/tighten",
    ),
    (
        "DELETE",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions",
    ),
    (
        "PUT",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions/source",
    ),
    (
        "POST",
        "/agents/00000000-0000-0000-0000-00000000b07a/tool-permissions/detach",
    ),
    (
        "GET",
        "/agent-tool-permissions/sources?agentId=00000000-0000-0000-0000-00000000b07a",
    ),
    // A query the service would refuse is still not found while off.
    ("GET", "/agent-tool-permissions/sources?scope=team"),
    (
        "GET",
        "/agent-tool-permissions/policies/00000000-0000-0000-0000-00000000501c",
    ),
    (
        "GET",
        "/agent-tool-permissions/teams/00000000-0000-0000-0000-0000000007ea",
    ),
    (
        "PUT",
        "/agent-tool-permissions/teams/00000000-0000-0000-0000-0000000007ea",
    ),
    (
        "DELETE",
        "/agent-tool-permissions/teams/00000000-0000-0000-0000-0000000007ea",
    ),
];

#[tokio::test]
async fn every_route_is_not_found_while_the_feature_is_off() {
    let permissions = Arc::new(FakePermissions {
        error: || PermissionError::Disabled,
        callers: Mutex::new(vec![]),
    });
    for (method, uri) in AGENT_ROUTES {
        let (status, body) = send(app(Arc::clone(&permissions)), method, uri, "person").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri}");
        assert_eq!(body["code"], "not_found");
    }
    assert_eq!(
        permissions.callers.lock().unwrap().len(),
        AGENT_ROUTES.len()
    );
}

#[tokio::test]
async fn the_credential_reaches_the_service_as_what_it_is() {
    let permissions = Arc::new(FakePermissions {
        error: || PermissionError::Forbidden,
        callers: Mutex::new(vec![]),
    });
    for token in ["person", "agent", "key"] {
        send(
            app(Arc::clone(&permissions)),
            "GET",
            AGENT_ROUTES[1].1,
            token,
        )
        .await;
    }
    assert_eq!(
        *permissions.callers.lock().unwrap(),
        vec![
            Credential::PersonSession,
            Credential::Agent {
                agent: BotId::TEST_A,
                session: None,
            },
            Credential::Other,
        ]
    );
}

#[test]
fn refusals_answer_with_their_status_and_code() {
    let response = |error| {
        let response = ToolPermissionApiError(error).into_response();
        response.status()
    };
    assert_eq!(response(PermissionError::NotFound), StatusCode::NOT_FOUND);
    assert_eq!(response(PermissionError::Forbidden), StatusCode::FORBIDDEN);
    assert_eq!(
        response(PermissionError::NeedsPerson),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        response(PermissionError::Invalid("no changes".to_owned())),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        response(PermissionError::UnknownTarget(vec![])),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        response(PermissionError::WouldLoosen(vec![])),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn would_loosen_names_the_operations_and_needs_person_says_why() {
    let permissions = Arc::new(FakePermissions {
        error: || {
            PermissionError::WouldLoosen(vec![LoosenedOperation {
                service: "email".to_owned(),
                operation: "send_email".to_owned(),
                label: "Send email".to_owned(),
                from: PermissionState::Never,
                to: PermissionState::Always,
            }])
        },
        callers: Mutex::new(vec![]),
    });
    let (status, body) = send(app(permissions), "POST", AGENT_ROUTES[3].1, "agent").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["operations"],
        serde_json::json!([{
            "service": "email",
            "operation": "send_email",
            "label": "Send email",
            "from": "never",
            "to": "always",
        }])
    );

    let permissions = Arc::new(FakePermissions {
        error: || PermissionError::NeedsPerson,
        callers: Mutex::new(vec![]),
    });
    let (status, body) = send(app(permissions), "PUT", AGENT_ROUTES[2].1, "agent").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "needs_person");
    assert_eq!(
        body["message"],
        "Only a person signed in to Macro can loosen or reset an agent's permissions."
    );
}

#[test]
fn a_change_reads_from_the_wire() {
    let changes: ToolPermissionChanges = serde_json::from_value(serde_json::json!({
        "changes": [
            { "target": { "kind": "group_action", "group": "documents", "action": "destroy" }, "state": "ask" },
            { "target": { "kind": "tool", "service": "storage", "operation": "delete_document" }, "state": null },
        ],
    }))
    .unwrap();
    assert_eq!(
        changes.changes,
        vec![
            Change {
                target: Target::GroupAction {
                    group: "documents".to_owned(),
                    action: Action::Destroy,
                },
                state: Some(PermissionState::Ask),
            },
            Change {
                target: Target::Tool {
                    service: "storage".to_owned(),
                    operation: "delete_document".to_owned(),
                },
                state: None,
            },
        ]
    );
}

#[tokio::test]
async fn a_follower_looser_than_its_source_is_a_conflict_naming_the_source() {
    let permissions = Arc::new(FakePermissions {
        error: || PermissionError::FollowsSource {
            operations: vec![LoosenedOperation {
                service: "email".to_owned(),
                operation: "send_message".to_owned(),
                label: "Send email".to_owned(),
                from: PermissionState::Never,
                to: PermissionState::Always,
            }],
            followed: Some(PolicyId::from_uuid(Uuid::from_u128(0x501c))),
        },
        callers: Mutex::new(vec![]),
    });
    let (status, body) = send(app(permissions), "PUT", AGENT_ROUTES[2].1, "person").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "follows_source");
    assert_eq!(body["source"], "00000000-0000-0000-0000-00000000501c");
    assert_eq!(body["operations"][0]["operation"], "send_message");
}

#[tokio::test]
async fn source_refusals_have_their_codes() {
    for (error, status, code) in [
        (
            (|| PermissionError::SourceCycle) as fn() -> PermissionError,
            StatusCode::CONFLICT,
            "source_cycle",
        ),
        (
            || PermissionError::SourceTooDeep,
            StatusCode::CONFLICT,
            "source_too_deep",
        ),
        (
            || PermissionError::SourceNotAllowed,
            StatusCode::FORBIDDEN,
            "source_not_allowed",
        ),
    ] {
        let permissions = Arc::new(FakePermissions {
            error,
            callers: Mutex::new(vec![]),
        });
        let (got, body) = send(app(permissions), "PUT", AGENT_ROUTES[5].1, "person").await;
        assert_eq!((got, body["code"].as_str()), (status, Some(code)));
    }
}
