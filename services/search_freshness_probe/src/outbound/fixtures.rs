//! The fixtures: an agent session and a call record seeded once for the probe
//! user and titled with the probe's marker. Creating a session provisions a
//! runtime, and a call record exists only once a call with a transcript is
//! archived, so the probe renames them instead.
//!
//! A fixture is found through search, by the marker in its title, once per
//! process. Their rename bodies are spelled out here for the same reason as
//! in `entities.rs`.

use reqwest::Method;
use serde::Serialize;

use super::macro_api::{ApiError, Call, MacroApi};
use super::search::UnifiedSearch;
use crate::domain::model::{EntityId, EntityType, Token};
use crate::domain::ports::FixtureWrites;

#[cfg(test)]
mod test;

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
}

impl AgentSessions {
    /// Sessions renamed through `api` and found through `search`.
    pub fn new(api: MacroApi, search: UnifiedSearch) -> Self {
        Self { api, search }
    }
}

impl FixtureWrites for AgentSessions {
    type Err = ApiError;

    const ENTITY_TYPE: EntityType = EntityType::AgentSession;

    async fn find(&mut self) -> Result<Option<EntityId>, ApiError> {
        Ok(self
            .search
            .marked(Self::ENTITY_TYPE)
            .await?
            .first()
            .copied())
    }

    async fn rename(&mut self, id: EntityId, title: &Token) -> Result<(), ApiError> {
        self.api
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
            .await
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
            .marked(Self::ENTITY_TYPE)
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
