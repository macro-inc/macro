use super::{
    PushAuthentication, PushAuthenticationError, PushKeyCache, PushKeySource, PushTokenVerifier,
};
use models_email::gmail::inbox_sync::{JwtVerificationError, KeyMap};

pub struct GooglePushAuthentication<C, S, V> {
    pub cache: C,
    pub source: S,
    pub verifier: V,
}

impl<C: PushKeyCache, S: PushKeySource, V: PushTokenVerifier> GooglePushAuthentication<C, S, V> {
    /// Retains the original key-lookup span with no recorded fields.
    #[tracing::instrument(skip(self))]
    async fn get_google_public_keys(&self) -> Result<KeyMap, S::Err> {
        let cached_keys = self
            .cache
            .read()
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "Failed to get Google public keys from Redis, falling back");
            })
            .ok()
            .flatten();

        match cached_keys {
            Some(keys) => Ok(keys),
            None => self.fetch_and_cache_google_public_keys().await,
        }
    }

    /// Retains the original refresh span with no recorded fields.
    #[tracing::instrument(skip(self))]
    async fn fetch_and_cache_google_public_keys(&self) -> Result<KeyMap, S::Err> {
        let fetched_keys = self.source.fetch().await?;
        if let Err(cache_error) = self.cache.write(&fetched_keys).await {
            tracing::warn!(error=?cache_error, "Failed to cache Google public keys in Redis");
        }
        Ok(fetched_keys.keys)
    }
}

impl<C: PushKeyCache, S: PushKeySource, V: PushTokenVerifier> PushAuthentication
    for GooglePushAuthentication<C, S, V>
{
    async fn authenticate(
        &self,
        authorization: Option<&str>,
    ) -> Result<(), PushAuthenticationError> {
        let public_keys = self.get_google_public_keys().await.map_err(|e| {
            tracing::error!(error=?e, "unable to get google public keys");
            PushAuthenticationError::PublicKeysUnavailable
        })?;

        let bearer_token = authorization
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or_else(|| {
                tracing::warn!("No bearer token provided in request headers");
                PushAuthenticationError::MissingBearerToken
            })?;

        match self.verifier.verify(bearer_token, public_keys) {
            Ok(()) => Ok(()),
            Err(first_error) => match first_error {
                JwtVerificationError::KeyNotFound(_) | JwtVerificationError::InvalidSignature => {
                    tracing::warn!(
                        "Token verification failed due to possible key rotation, refreshing keys and retrying. Error: {:?}",
                        first_error
                    );
                    let fresh_public_keys = self
                        .fetch_and_cache_google_public_keys()
                        .await
                        .map_err(|e| {
                            tracing::error!(error=?e, "Failed to refresh Google public keys");
                            PushAuthenticationError::RefreshFailed
                        })?;
                    self.verifier
                        .verify(bearer_token, fresh_public_keys)
                        .map_err(|second_error| {
                            tracing::error!(
                                first_error=?first_error,
                                second_error=?second_error,
                                "Token verification failed even with refreshed keys"
                            );
                            PushAuthenticationError::InvalidToken
                        })
                }
                _ => {
                    tracing::error!(error=?first_error, "Token verification failed with non-key related error");
                    Err(PushAuthenticationError::InvalidToken)
                }
            },
        }
    }
}
