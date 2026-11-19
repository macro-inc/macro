//! The fixtures: an agent session and a call record of the probe user, titled
//! with the probe's marker, renamed every round rather than created. A call
//! record exists only once a call with a transcript is archived, so it is
//! seeded by hand; the probe creates its agent session itself when it has
//! none, once, and a session starts shared with no one.
//!
//! A fixture is found through search, by its title, and looked up again after
//! a rename fails. Their rename bodies are spelled out here for the same reason as
//! in `entities.rs`.

use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::macro_api::{ApiError, Call, MacroApi};
use super::search::UnifiedSearch;
use crate::domain::model::{EntityId, EntityType, Token};
use crate::domain::ports::FixtureWrites;

#[cfg(test)]
mod test;

/// A session with the deployment's default persona and no prompt: it stays
/// idle. Every field of the create request is optional.
#[derive(Serialize)]
struct CreateSession {}

/// The id of the session created.
#[derive(Deserialize)]
struct CreatedSession {
    session: CreatedSessionId,
}

#[derive(Deserialize)]
struct CreatedSessionId {
    id: Uuid,
}

/// Mirrors `agent_session::inbound::axum_router`'s rename request.
#[derive(Serialize)]
struct RenameSession {
    name: String,
}

/// Mirrors `call::domain::models`' call record patch.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameCall {
    custom_name: String,
}

/// The probe user's agent session titled with the marker.
pub struct AgentSessions {
    api: MacroApi,
    search: UnifiedSearch,
    /// The session this process created, which search may not show yet.
    created: Option<EntityId>,
}

impl AgentSessions {
    /// Sessions renamed through `api` and found through `search`.
    pub fn new(api: MacroApi, search: UnifiedSearch) -> Self {
        Self {
            api,
            search,
            created: None,
        }
    }
}

impl FixtureWrites for AgentSessions {
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::AgentSession;

    async fn find(&mut self) -> Result<Option<EntityId>, ApiError> {
        if let Some(found) = self
            .search
            .fixtures(Self::ENTITY_TYPE)
            .await?
            .first()
            .copied()
        {
            return Ok(Some(found));
        }
        if let Some(created) = self.created {
            return Ok(Some(created));
        }

        let created: CreatedSession = self
            .api
            .json(
                Call::new(
                    Method::POST,
                    "/agent-harness/agent-sessions",
                    "/agent-harness/agent-sessions".to_owned(),
                ),
                Some(&CreateSession {}),
            )
            .await?;
        let id = EntityId(created.session.id);
        self.created = Some(id);
        Ok(Some(id))
    }

    async fn rename(&mut self, id: EntityId, title: &Token) -> Result<(), ApiError> {
        let renamed = self
            .api
            .send_done(
                Call::new(
                    Method::PUT,
                    "/agent-harness/agent-sessions/{session_id}/name",
                    format!("/agent-harness/agent-sessions/{id}/name"),
                ),
                Some(&RenameSession {
                    name: title.title(),
                }),
                &[],
            )
            .await;
        // A session that is gone, not ours, or archived will not come back:
        // forget it, so the next lookup creates another rather than
        // returning it again. Other failures keep it, since search may only
        // be slow to show it.
        if let Err(ApiError::Status {
            status: StatusCode::NOT_FOUND | StatusCode::FORBIDDEN | StatusCode::CONFLICT,
            ..
        }) = renamed
            && self.created == Some(id)
        {
            self.created = None;
        }
        renamed
    }
}

/// The probe user's call record titled with the marker.
pub struct Calls {
    api: MacroApi,
    search: UnifiedSearch,
}

impl Calls {
    /// Call records renamed through `api` and found through `search`.
    pub fn new(api: MacroApi, search: UnifiedSearch) -> Self {
        Self { api, search }
    }
}

impl FixtureWrites for Calls {
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::Call;

    async fn find(&mut self) -> Result<Option<EntityId>, ApiError> {
        Ok(self
            .search
            .fixtures(Self::ENTITY_TYPE)
            .await?
            .first()
            .copied())
    }

    async fn rename(&mut self, id: EntityId, title: &Token) -> Result<(), ApiError> {
        self.api
            .send_done(
                Call::new(
                    Method::PATCH,
                    "/dss/call/record/{call_id}",
                    format!("/dss/call/record/{id}"),
                ),
                Some(&RenameCall {
                    custom_name: title.title(),
                }),
                &[],
            )
            .await
    }
}
