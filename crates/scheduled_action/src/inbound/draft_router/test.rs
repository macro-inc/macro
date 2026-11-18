use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use axum::http::StatusCode;
use macro_authorization::MacroAuthorizationState;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};

use super::{RoutineDraftRouterState, routine_draft_router};
use crate::domain::drafts::{Draft, DraftContext, DraftRequest, InvalidDraft};
use crate::domain::ports::RoutineDraftService;
use crate::inbound::axum_router::test::{FakeAuth, request};

/// Drafts nothing: says who asked, or refuses a blank description.
struct Drafts;

impl RoutineDraftService for Drafts {
    async fn draft(
        &self,
        owner: MacroUserIdStr<'static>,
        request: DraftRequest,
        _: DraftContext,
    ) -> Result<Draft> {
        match request {
            DraftRequest::Routine { description } if description.trim().is_empty() => {
                Err(InvalidDraft("describe it".into()).into())
            }
            _ => Ok(Draft::Failed {
                message: owner.as_ref().to_owned(),
                created: Vec::new(),
            }),
        }
    }
}

fn router() -> Router {
    routine_draft_router(RoutineDraftRouterState {
        service: Arc::new(Drafts),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

fn body(description: &str) -> Value {
    json!({
        "draft": { "type": "routine", "description": description },
        "context": { "timezone": "UTC", "agentModel": "anthropic/claude-sonnet-5-5" },
    })
}

#[tokio::test]
async fn drafts_for_the_signed_in_user() {
    let app = router();
    let path = "/scheduled-actions/drafts";

    let (status, draft) = request(&app, "POST", path, "owner", body("label invoices")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(draft["outcome"], "failed");
    assert!(draft["message"].as_str().unwrap().starts_with("macro|"));

    assert_eq!(
        request(&app, "POST", path, "invalid", body("x")).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "POST", path, "owner", body(" ")).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "POST",
            path,
            "owner",
            json!({ "draft": { "type": "poem" } })
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn still_drafts_for_web_clients_that_send_workspace_lists() {
    let mut old = body("label invoices");
    old["context"]["workspace"] = json!({
        "labels": ["Finance"],
        "channels": [{ "name": "eng", "id": "c1" }],
    });

    let (status, _) = request(&router(), "POST", "/scheduled-actions/drafts", "owner", old).await;

    assert_eq!(status, StatusCode::OK);
}
