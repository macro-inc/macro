//! Fleet-only bootstrap issuance from the account-owning auth service.

use hosted_runtimes::domain::{
    ids::ComputerId,
    persona_credentials::{EnrollmentGeneration, PersonaCredentialError, PersonaEnrollment},
    ports::{ComputerRepo, PersonaCredentialSource},
};
use macro_authorization::INTERNAL_API_KEY_HEADER;
use std::time::Duration;

/// No response bodies or plaintext credentials are retained or logged.
pub struct AuthPersonaCredentials {
    http: reqwest::Client,
    base: macro_service_urls::AuthServiceUrl,
    key: Option<reqwest::header::HeaderValue>,
    repo: hosted_runtimes::outbound::pg::PgComputerRepo,
}

impl AuthPersonaCredentials {
    pub(super) fn new(
        internal_key: Option<&str>,
        repo: hosted_runtimes::outbound::pg::PgComputerRepo,
    ) -> anyhow::Result<Self> {
        let key = internal_key
            .map(|raw| {
                anyhow::ensure!(
                    !raw.is_empty(),
                    "internal enrollment authorization must not be empty"
                );
                let mut key = reqwest::header::HeaderValue::from_str(raw)?;
                key.set_sensitive(true);
                Ok::<_, anyhow::Error>(key)
            })
            .transpose()?;
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .pool_max_idle_per_host(0)
                .build()?,
            base: macro_service_urls::AuthServiceUrl::new()?,
            key,
            repo,
        })
    }
}

impl PersonaCredentialSource for AuthPersonaCredentials {
    #[tracing::instrument(name = "computers.persona.issue", skip_all, fields(%computer, generation = generation.get()), err)]
    async fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> Result<PersonaEnrollment, PersonaCredentialError> {
        let saved = self
            .repo
            .get(computer)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?
            .ok_or(PersonaCredentialError::NotFound)?
            .into_healthy()
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        if saved.persona.is_none() {
            return Ok(PersonaEnrollment::default());
        }
        let key = self
            .key
            .as_ref()
            .ok_or(PersonaCredentialError::Unavailable)?;
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
            .header(INTERNAL_API_KEY_HEADER, key)
            .send()
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(PersonaCredentialError::NotFound);
        }
        if !response.status().is_success() {
            return Err(PersonaCredentialError::IssuanceFailed);
        }
        response
            .json()
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)
    }
}
