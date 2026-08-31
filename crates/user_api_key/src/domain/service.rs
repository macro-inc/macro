//! User API key service implementation.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{UserApiKey, UserApiKeyError};
use crate::domain::ports::{UserApiKeyService, UserApiKeysRepo};

/// Upper bound on keys per user.
pub const MAX_KEYS_PER_USER: usize = 20;

/// Concrete user API key service backed by a [UserApiKeysRepo].
#[derive(Debug, Clone)]
pub struct UserApiKeyServiceImpl<R> {
    repo: R,
}

impl<R> UserApiKeyServiceImpl<R>
where
    R: UserApiKeysRepo,
{
    /// Create a user API key service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> UserApiKeyService for UserApiKeyServiceImpl<R>
where
    R: UserApiKeysRepo,
{
    #[tracing::instrument(err, skip_all)]
    async fn create_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<UserApiKey, UserApiKeyError> {
        let count = self
            .repo
            .count_keys(user_id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if count as usize >= MAX_KEYS_PER_USER {
            return Err(UserApiKeyError::BadRequest(format!(
                "cannot have more than {MAX_KEYS_PER_USER} api keys"
            )));
        }
        let key = UserApiKey::generate();
        self.repo
            .insert_key(user_id, &key)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(key)
    }

    #[tracing::instrument(err, skip_all)]
    async fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<UserApiKey>, UserApiKeyError> {
        Ok(self
            .repo
            .list_keys(user_id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?)
    }

    #[tracing::instrument(err, skip_all)]
    async fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> Result<(), UserApiKeyError> {
        let removed = self
            .repo
            .delete_key(user_id, key)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        if removed {
            Ok(())
        } else {
            Err(UserApiKeyError::NotFound)
        }
    }
}
