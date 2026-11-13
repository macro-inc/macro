//! The agent part of an agent teammate computer's enrollment, issued by
//! authentication_service, which owns the agent's account and credentials.

use std::time::Duration;

use hosted_runtimes::domain::{
    agent::{AgentEnrollment, AgentEnrollmentError, AgentEnrollmentFuture, AgentEnrollmentSource},
    enrollment::EnrollmentGeneration,
    ids::ComputerId,
};
use macro_authorization::INTERNAL_API_KEY_HEADER;
use reqwest::{StatusCode, header::HeaderValue};

/// Calls `POST /internal/team_agent_enrollment/{computer}/{generation}`.
/// Neither response bodies nor credentials are logged.
pub(crate) struct AuthAgentEnrollment {
    http: reqwest::Client,
    base: macro_service_urls::AuthServiceUrl,
    key: HeaderValue,
}

impl AuthAgentEnrollment {
    pub(crate) fn new(internal_api_key: &str) -> anyhow::Result<Self> {
        anyhow::ensure!(
            !internal_api_key.is_empty(),
            "agent enrollment needs the internal API key"
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

    async fn fetch(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> Result<Option<AgentEnrollment>, AgentEnrollmentError> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .http
            .post(format!(
                "{}/internal/team_agent_enrollment/{computer}/{}",
                self.base.trim_end_matches('/'),
                generation.get()
            ))
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.key.clone())
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
    }
}

impl AgentEnrollmentSource for AuthAgentEnrollment {
    fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> AgentEnrollmentFuture<'_> {
        let span = tracing::info_span!(
            "computers.agent_enrollment.issue",
            %computer,
            generation = generation.get()
        );
        Box::pin(tracing::Instrument::instrument(
            self.fetch(computer, generation),
            span,
        ))
    }
}
