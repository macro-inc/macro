use std::sync::Arc;

use anyhow::{Result, bail};
use axum::Router;
use axum::http::StatusCode;
use macro_authorization::MacroAuthorizationState;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};

use super::{AgentRoutineRouterState, agent_routine_router};
use crate::domain::agent_routines::AgentRoutines;
use crate::domain::models::ActionPolicyError;
use crate::domain::ports::AgentRoutineService;
use crate::inbound::axum_router::test::{FakeAuth, request};

const AGENT: &str = "macro|agent@macro.com";

/// The caller `owner` oversees `AGENT`, which has no routines; everything
/// else is not found.
struct Routines;

impl AgentRoutineService for Routines {
    async fn agent_routines(
        &self,
        viewer: &MacroUserIdStr<'_>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentRoutines> {
        if viewer.as_ref() != crate::domain::service::test::USER || agent.as_ref() != AGENT {
            bail!(ActionPolicyError::NotFound);
        }
        Ok(AgentRoutines {
            routines: Vec::new(),
            truncated: false,
        })
    }
}

fn router() -> Router {
    agent_routine_router(AgentRoutineRouterState {
        service: Arc::new(Routines),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

#[tokio::test]
async fn reads_an_agent_by_its_encoded_user_id() {
    let (status, body) = request(
        &router(),
        "GET",
        "/scheduled-actions/agents/macro%7Cagent%40macro.com",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "routines": [], "truncated": false }));
}

#[tokio::test]
async fn answers_not_found_for_anyone_else_or_an_id_that_names_no_user() {
    let app = router();
    for (path, token) in [
        (
            "/scheduled-actions/agents/macro%7Cagent%40macro.com",
            "other",
        ),
        ("/scheduled-actions/agents/not-a-user", "owner"),
    ] {
        let (status, _) = request(&app, "GET", path, token, Value::Null).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path} as {token}");
    }
    let (status, _) = request(
        &app,
        "GET",
        "/scheduled-actions/agents/macro%7Cagent%40macro.com",
        "nobody",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
