//! The authentication service's install routes, which own the agent's
//! credentials: `POST /internal/team_agent_install/{harness}/{install}`
//! (count and mint the next delivery) and
//! `POST /internal/team_agent_install/{install}/checkpointed`. Neither
//! response bodies nor credentials are logged.

use std::time::Duration;

use futures::future::BoxFuture;
use harness_id::HarnessId;
use hosted_runtimes::domain::agent::AgentEnrollmentError;
use macro_authorization::INTERNAL_API_KEY_HEADER;
use reqwest::{StatusCode, header::HeaderValue};
use team_agents::domain::self_hosting::IssuedInstall;
use team_agents::inbound::axum_router::{IssueInstallRequest, ReportedDelivery};
use uuid::Uuid;

use super::{CheckpointUnfinished, InstallIssuer};

/// Calls the authentication service with the internal key.
pub(crate) struct AuthInstalls {
    http: reqwest::Client,
    base: macro_service_urls::AuthServiceUrl,
    key: HeaderValue,
}

impl AuthInstalls {
    pub(crate) fn new(internal_api_key: &str) -> anyhow::Result<Self> {
        anyhow::ensure!(
            !internal_api_key.is_empty(),
            "teammate delivery needs the internal API key"
        );
        let mut key = HeaderValue::from_str(internal_api_key)?;
        key.set_sensitive(true);
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()?,
            base: macro_service_urls::AuthServiceUrl::new()?,
            key,
        })
    }

    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        self.http
            .post(format!(
                "{}/internal/team_agent_install/{path}",
                self.base.trim_end_matches('/')
            ))
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.key.clone())
    }
}

impl InstallIssuer for AuthInstalls {
    fn issue(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> BoxFuture<'_, Result<Option<IssuedInstall>, AgentEnrollmentError>> {
        Box::pin(async move {
            let body = IssueInstallRequest {
                reported: reported.map(|(generation, delivery)| ReportedDelivery {
                    generation,
                    delivery,
                }),
            };
            let response = self
                .post(&format!("{harness}/{install_id}"))
                .json(&body)
                .send()
                .await
                .map_err(|_| AgentEnrollmentError::IssuanceFailed)?;
            match response.status() {
                StatusCode::NO_CONTENT => Ok(None),
                StatusCode::NOT_FOUND => Err(AgentEnrollmentError::NotFound),
                status if status.is_success() => response
                    .json()
                    .await
                    .map(Some)
                    .map_err(|_| AgentEnrollmentError::IssuanceFailed),
                _ => Err(AgentEnrollmentError::IssuanceFailed),
            }
        })
    }

    fn checkpointed(&self, install_id: Uuid) -> BoxFuture<'_, Result<(), CheckpointUnfinished>> {
        Box::pin(async move {
            let response = self
                .post(&format!("{install_id}/checkpointed"))
                .send()
                .await
                .map_err(|_| CheckpointUnfinished)?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(CheckpointUnfinished)
            }
        })
    }
}
