use super::PushAuthenticationError;
use models_email::gmail::inbox_sync::{GooglePublicKeys, JwtVerificationError, KeyMap};
use uuid::Uuid;

pub trait PushKeyCache: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;
    fn read(&self) -> impl Future<Output = Result<Option<KeyMap>, Self::Err>> + Send;
    fn write(&self, keys: &GooglePublicKeys) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

pub trait PushKeySource: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;
    /// Retains the source's original fetch context in its error.
    fn fetch(&self) -> impl Future<Output = Result<GooglePublicKeys, Self::Err>> + Send;
}

pub trait PushTokenVerifier: Send + Sync + 'static {
    fn verify(&self, token: &str, keys: KeyMap) -> Result<(), JwtVerificationError>;
}

pub trait PushAuthentication: Send + Sync + 'static {
    fn authenticate(
        &self,
        authorization: Option<&str>,
    ) -> impl Future<Output = Result<(), PushAuthenticationError>> + Send;
}

pub trait GmailPushQueue: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;
    fn notify(
        &self,
        link_id: Uuid,
        history_id: u64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
