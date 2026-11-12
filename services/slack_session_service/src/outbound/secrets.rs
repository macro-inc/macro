//! [`Secrets`] over `slack_linked`'s KMS sealing.

use kms_envelope::kms::EnvelopeKms;
use slack_client::SessionCredentials;
use slack_linked::domain::events::StoredSecret;
use slack_linked::outbound::kms::{OpenError, SecretPurpose, open, seal};
use uuid::Uuid;

use crate::domain::ports::{OpenFailure, Secrets};

/// Seals and opens with one KMS key.
pub struct KmsSecrets<Kms> {
    kms: Kms,
}

impl<Kms> KmsSecrets<Kms> {
    /// Use `kms` (`GenerateDataKey` + `Decrypt` on the Slack key).
    pub fn new(kms: Kms) -> Self {
        Self { kms }
    }
}

fn failure(error: OpenError) -> OpenFailure {
    match error {
        OpenError::Unavailable => OpenFailure::Unavailable,
        OpenError::Unreadable => OpenFailure::Unreadable,
    }
}

impl<Kms: EnvelopeKms + 'static> Secrets for KmsSecrets<Kms> {
    async fn open_credentials(
        &self,
        user_id: &str,
        account: Uuid,
        secret: &StoredSecret,
    ) -> Result<SessionCredentials, OpenFailure> {
        let bytes = open(&self.kms, SecretPurpose::SlackSession, user_id, account, secret)
            .await
            .map_err(failure)?;
        serde_json::from_slice(&bytes).map_err(|_| OpenFailure::Unreadable)
    }

    async fn seal_credentials(
        &self,
        user_id: &str,
        account: Uuid,
        credentials: &SessionCredentials,
    ) -> Result<StoredSecret, OpenFailure> {
        let bytes = zeroize::Zeroizing::new(
            serde_json::to_vec(credentials).map_err(|_| OpenFailure::Unreadable)?,
        );
        seal(&self.kms, SecretPurpose::SlackSession, user_id, account, &bytes)
            .await
            .map_err(|_| OpenFailure::Unavailable)
    }

    async fn open_login_input(
        &self,
        user_id: &str,
        attempt: Uuid,
        secret: &StoredSecret,
    ) -> Result<Vec<u8>, OpenFailure> {
        open(&self.kms, SecretPurpose::SlackLoginInput, user_id, attempt, secret)
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(failure)
    }

    async fn open_login_state(
        &self,
        user_id: &str,
        attempt: Uuid,
        secret: &StoredSecret,
    ) -> Result<Vec<u8>, OpenFailure> {
        open(&self.kms, SecretPurpose::SlackLogin, user_id, attempt, secret)
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(failure)
    }

    async fn seal_login_state(
        &self,
        user_id: &str,
        attempt: Uuid,
        state: &[u8],
    ) -> Result<StoredSecret, OpenFailure> {
        seal(&self.kms, SecretPurpose::SlackLogin, user_id, attempt, state)
            .await
            .map_err(|_| OpenFailure::Unavailable)
    }
}
