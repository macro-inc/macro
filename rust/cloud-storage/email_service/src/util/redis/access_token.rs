use crate::util::redis::RedisClient;
use anyhow::Context;
use models_email::gmail::webhook::{GooglePublicKeys, KeyMap};
use models_email::service::cache::TokenCacheKey;
use redis::AsyncCommands;

/// ten minutes less than the hour the token is valid for, for long-running jobs
static GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS: u64 = 3000;
const GOOGLE_PUBLIC_KEYS_CACHE_KEY: &str = "google_public_keys";
const GOOGLE_PUBLIC_KEYS_DEFAULT_EXPIRY_SECONDS: u64 = 3600;

impl RedisClient {
    /// add the access token value to the cache with expiry
    pub async fn set_gmail_access_token(
        &self,
        key: &TokenCacheKey,
        access_token: &str,
    ) -> anyhow::Result<()> {
        let key = key.to_redis_key();

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection
            .set_ex::<&str, &str, ()>(&key, access_token, GMAIL_ACCESS_TOKEN_EXPIRY_SECONDS)
            .await?;
        Ok(())
    }

    pub async fn get_gmail_access_token(
        &self,
        key: &TokenCacheKey,
    ) -> anyhow::Result<Option<String>> {
        let key = key.to_redis_key();

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        let value = redis_connection.get::<&str, Option<String>>(&key).await?;
        Ok(value)
    }

    /// delete the access token from the cache
    pub async fn delete_gmail_access_token(&self, key: &TokenCacheKey) -> anyhow::Result<()> {
        let key = key.to_redis_key();

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection.del::<&str, ()>(&key).await?;
        Ok(())
    }

    /// Store Google public keys in the cache
    pub async fn set_google_public_keys(
        &self,
        public_keys: &GooglePublicKeys,
    ) -> anyhow::Result<()> {
        let serialized_keys = serde_json::to_string(&public_keys.keys)
            .context("Failed to serialize Google public keys")?;

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        let expiry_seconds = if public_keys.max_age_seconds > 0 {
            public_keys.max_age_seconds
        } else {
            GOOGLE_PUBLIC_KEYS_DEFAULT_EXPIRY_SECONDS
        };

        redis_connection
            .set_ex::<&str, &str, ()>(
                GOOGLE_PUBLIC_KEYS_CACHE_KEY,
                &serialized_keys,
                expiry_seconds,
            )
            .await?;

        Ok(())
    }

    /// Retrieve Google public keys from the cache
    pub async fn get_google_public_keys(&self) -> anyhow::Result<Option<KeyMap>> {
        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        let value = redis_connection
            .get::<&str, Option<String>>(GOOGLE_PUBLIC_KEYS_CACHE_KEY)
            .await?;

        match value {
            Some(json_str) => {
                let keys_map: KeyMap = serde_json::from_str(&json_str)
                    .context("Failed to deserialize cached Google public keys")?;
                Ok(Some(keys_map))
            }
            None => Ok(None),
        }
    }
}
