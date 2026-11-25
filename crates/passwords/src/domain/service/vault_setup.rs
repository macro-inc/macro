//! Automatic setup of a team's missing vault on its first authorized write.
//!
//! Every path here runs under the team lease. The first write that finds no
//! namespace records a setup request and asks the provisioner synchronously; a
//! later write finds the request and returns `SettingUp` at once, leaving the
//! resume worker to finish it. A missing namespace that existed before is drift:
//! it is recorded for an operator and never recreated.
use super::*;
use std::time::Duration;

/// How long the first write waits for the provisioner while holding the lease.
const FIRST_ATTEMPT: Duration = Duration::from_secs(8);

impl PasswordService {
    /// Decide what a missing namespace means for this team and, on its first
    /// write, set the vault up. `Ok` means the namespace now exists.
    #[tracing::instrument(skip_all, err, name = "passwords.vault.setup", fields(team_id = %team.0, trigger = "lazy", outcome = tracing::field::Empty, created = tracing::field::Empty))]
    pub(crate) async fn ensure_vault(&self, team: TeamId) -> Result<(), Error> {
        if !self.setup.configured() {
            tracing::Span::current().record("outcome", "not_configured");
            return Err(Error::NotProvisioned);
        }
        let result = match self.repository.vault_setup(team).await? {
            Some(VaultSetupState::Ready) => self.drift(team).await,
            Some(VaultSetupState::NeedsRecovery) => Err(Error::NeedsRecovery),
            Some(VaultSetupState::Failed) => Err(Error::SetupFailed),
            Some(VaultSetupState::SettingUp) => Err(Error::SettingUp),
            None if self.repository.has_vault_values(team).await? => self.drift(team).await,
            None if !self.repository.request_vault_setup(team).await? => Err(Error::SettingUp),
            None => return self.attempt_setup(team, FIRST_ATTEMPT).await,
        };
        tracing::Span::current().record("outcome", outcome(&result));
        result
    }

    /// The namespace existed once: record it for an operator, never recreate it.
    async fn drift(&self, team: TeamId) -> Result<(), Error> {
        self.repository
            .record_vault_setup(team, VaultSetupState::NeedsRecovery)
            .await?;
        tracing::warn!(team_id = %team.0, "passwords team vault is missing after it existed; needs recovery");
        Err(Error::NeedsRecovery)
    }

    /// Ask the provisioner once and record what it answered. A timeout or
    /// provisioner failure leaves the request for the resume worker.
    async fn attempt_setup(&self, team: TeamId, deadline: Duration) -> Result<(), Error> {
        let (state, result) = match self.setup.provision(team, deadline).await {
            Ok(provisioned) => {
                tracing::Span::current().record("created", provisioned.created);
                (VaultSetupState::Ready, Ok(()))
            }
            Err(SetupError::Incompatible) => (VaultSetupState::Failed, Err(Error::SetupFailed)),
            Err(SetupError::Unavailable) => (VaultSetupState::SettingUp, Err(Error::SettingUp)),
        };
        self.repository.record_vault_setup(team, state).await?;
        tracing::Span::current().record("outcome", outcome(&result));
        result
    }

    /// While this team's setup is unfinished, a provider failure means "still
    /// setting up" (a partly created vault), not a generic outage.
    pub(crate) async fn while_setting_up(&self, team: TeamId, error: Error) -> Error {
        if !self.setup.configured() {
            return error;
        }
        match self.repository.vault_setup(team).await {
            Ok(Some(VaultSetupState::SettingUp)) => Error::SettingUp,
            _ => error,
        }
    }

    /// Release the lease before a `SettingUp` failure returns, so the next
    /// writer and the resume worker can take it without waiting for the
    /// connection's queued rollback.
    pub(crate) async fn settle(lock: Box<dyn ItemLock>, error: Error) -> Error {
        if error == Error::SettingUp
            && let Err(release) = lock.release().await
        {
            tracing::warn!(error = %release, "passwords lease release after vault setup failed");
        }
        error
    }

    /// Finish setups a write started: each due team under its lease, rechecking
    /// that the request is still open. Closed and deleted teams are never due.
    #[tracing::instrument(skip_all, err, name = "passwords.vault.setup.resume", fields(due = tracing::field::Empty))]
    pub async fn resume_vault_setup(&self) -> Result<(), Error> {
        if !self.setup.configured() {
            return Ok(());
        }
        let due = self.repository.vault_setup_due().await?;
        tracing::Span::current().record("due", due.len());
        for team in due {
            if let Err(error) = self.resume_one(team).await {
                tracing::warn!(team_id = %team.0, error = %error, "passwords vault setup resume failed; retained for retry");
            }
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, err, name = "passwords.vault.setup", fields(team_id = %team.0, trigger = "resume", outcome = tracing::field::Empty, created = tracing::field::Empty))]
    async fn resume_one(&self, team: TeamId) -> Result<(), Error> {
        let lock = match self.repository.lock(team, ItemId(Uuid::nil())).await {
            Ok(lock) => lock,
            Err(Error::Busy) => {
                tracing::Span::current().record("outcome", "busy");
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if self.repository.vault_setup(team).await? != Some(VaultSetupState::SettingUp) {
            tracing::Span::current().record("outcome", "resolved");
            return lock.release().await;
        }
        let result = match self.attempt_setup(team, FIRST_ATTEMPT).await {
            Err(Error::SettingUp | Error::SetupFailed) => Ok(()),
            result => result,
        };
        lock.release().await?;
        result
    }

    /// Readiness of the team's vault for a current human member. Read-only: it
    /// never starts a setup.
    #[tracing::instrument(skip_all, err, name = "passwords.vault.readiness", fields(team_id = %team.0))]
    pub async fn vault_readiness(
        &self,
        actor: &Actor,
        team: TeamId,
    ) -> Result<VaultReadiness, Error> {
        self.membership(actor, team).await?;
        Ok(self.repository.vault_setup(team).await?.into())
    }
}

fn outcome(result: &Result<(), Error>) -> &'static str {
    match result {
        Ok(()) => "ready",
        Err(Error::SettingUp) => "setting_up",
        Err(Error::SetupFailed) => "incompatible",
        Err(Error::NeedsRecovery) => "needs_recovery",
        Err(_) => "failed",
    }
}

#[cfg(test)]
mod test;
