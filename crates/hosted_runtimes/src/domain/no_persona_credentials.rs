//! Explicit composition policy until a persona credential provider is installed.

use super::ids::ComputerId;
use super::persona_credentials::{EnrollmentGeneration, PersonaCredentialError, PersonaEnrollment};
use super::ports::{ComputerRepo, PersonaCredentialSource};

/// Allows session-only computers, and fails closed for every persona computer.
pub struct NoPersonaCredentials<Repo> {
    repo: Repo,
}

impl<Repo: ComputerRepo> NoPersonaCredentials<Repo> {
    /// Use the computer repository to distinguish session-only computers.
    pub fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

impl<Repo: ComputerRepo> PersonaCredentialSource for NoPersonaCredentials<Repo> {
    #[tracing::instrument(name = "persona_credentials.unconfigured", skip(self), fields(computer_id = %computer), err)]
    async fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> Result<PersonaEnrollment, PersonaCredentialError> {
        let computer = self
            .repo
            .get(computer)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?
            .ok_or(PersonaCredentialError::NotFound)?
            .into_healthy()
            .map_err(|_| PersonaCredentialError::Unavailable)?;
        if computer.persona.is_some() {
            return Err(PersonaCredentialError::Unavailable);
        }
        Ok(PersonaEnrollment::default())
    }
}
