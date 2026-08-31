//! Ports (trait contracts) for the user API key domain.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{UserApiKey, UserApiKeyError};

/// Outbound persistence port for user API keys.
///
/// Every mutating and listing method is scoped to a user: a key belonging to
/// someone else simply misses rather than erroring.
pub trait UserApiKeysRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Persist a newly minted key for the user.
    fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Count the keys currently in the user's collection.
    fn count_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// List the user's keys, ordered by `key` for a stable response.
    fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<UserApiKey>, Self::Err>> + Send;

    /// Remove one of the user's keys. Returns `true` when a row was removed.
    fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Owner of a key, for the future authenticate-by-key use case.
    ///
    /// Not exposed through [UserApiKeyService] in this slice.
    fn find_user_id_by_key(
        &self,
        key: &UserApiKey,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Self::Err>> + Send;
}

/// Inbound service port: the user API key API used by drivers (HTTP).
pub trait UserApiKeyService: Send + Sync + 'static {
    /// Mint a new key for the user. The full secret is returned here and
    /// nowhere else once hashing lands.
    fn create_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<UserApiKey, UserApiKeyError>> + Send;

    /// List the user's keys.
    fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<UserApiKey>, UserApiKeyError>> + Send;

    /// Delete one of the user's keys. [UserApiKeyError::NotFound] when the
    /// key does not exist in the caller's collection.
    fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> impl Future<Output = Result<(), UserApiKeyError>> + Send;
}
