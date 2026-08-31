//! Ports (trait contracts) for the user API key domain.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    CreatedUserApiKey, UserApiKey, UserApiKeyError, UserApiKeyId, UserApiKeyInfo,
};

/// Outbound persistence port for user API keys.
///
/// Every mutating and listing method is scoped to a user: a key belonging to
/// someone else simply misses rather than erroring.
pub trait UserApiKeysRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Persist a newly minted key for the user. `hash` is SHA-256 of the secret.
    fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
        name: &str,
        hash: &[u8; 32],
    ) -> impl Future<Output = Result<UserApiKeyInfo, Self::Err>> + Send;

    /// Count the keys currently in the user's collection.
    fn count_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// List the user's keys as id, name, and created_at, newest first.
    fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<UserApiKeyInfo>, Self::Err>> + Send;

    /// Remove one of the user's keys by id. Returns `true` when a row was removed.
    fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Owner of a key, for the future authenticate-by-key use case.
    ///
    /// Looks up by SHA-256 of the presented secret. Not exposed through
    /// [UserApiKeyService] in this slice.
    fn find_user_id_by_key(
        &self,
        key: &UserApiKey,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Self::Err>> + Send;
}

/// Inbound service port: the user API key API used by drivers (HTTP).
pub trait UserApiKeyService: Send + Sync + 'static {
    /// Mint a new key for the user. The full secret is returned here and
    /// nowhere else.
    fn create_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        name: &str,
    ) -> impl Future<Output = Result<CreatedUserApiKey, UserApiKeyError>> + Send;

    /// List the user's keys as id, name, and created_at.
    fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<UserApiKeyInfo>, UserApiKeyError>> + Send;

    /// Delete one of the user's keys by opaque id. [UserApiKeyError::NotFound]
    /// when the key does not exist in the caller's collection.
    fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
    ) -> impl Future<Output = Result<(), UserApiKeyError>> + Send;
}
