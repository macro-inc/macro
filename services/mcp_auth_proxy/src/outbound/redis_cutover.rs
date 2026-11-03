//! Moves broker state from Redis to Postgres without logging anyone out.
//!
//! Postgres is the store of record. Redis is kept only so nothing written
//! there before the cutover is lost, and so replicas still on the Redis-only
//! build keep working until a rolling deploy replaces them:
//!
//! - Registrations, refresh token bindings, and grant revocations are written
//!   to both stores, and read from Postgres first. A miss falls back to Redis
//!   and copies what it finds into Postgres. [`backfill_from_redis`] copies
//!   the rest at startup.
//! - Pending authorizations and issued codes are written to Postgres only, so
//!   upstream tokens never go to Redis again and a code can be redeemed in only
//!   one store. A take falls back to Redis for handshakes started before the
//!   cutover; Redis consumes those atomically too.
//!   A handshake a new replica starts and an old one finishes fails once
//!   mid-rollout, and the client retries the login.
//!
//! Redis is best-effort throughout. A Redis failure is logged and treated as
//! a miss; it never fails a request Postgres can serve.
//!
//! Once every replica runs this build and the backfill has completed, the next
//! change wires [`PostgresAuthStore`] directly and deletes this module and the
//! Redis adapter.

#[cfg(test)]
mod test;

use std::sync::Arc;

use crate::domain::{
    models::{
        IssuedAuthorizationCode, PendingAuthorization, RefreshTokenBinding, RegisteredClient,
    },
    ports::{
        ClientRegistrationStore, GrantRevokedFuture, RefreshTokenBindingFuture,
        RefreshTokenBindingStore, RegisteredClientFuture, StoreWriteFuture,
    },
    service::{
        CLIENT_REGISTRATION_TTL, InflightAuthStore, REFRESH_TOKEN_BINDING_TTL, REVOKED_GRANT_TTL,
    },
};

use super::{
    postgres::PostgresAuthStore,
    redis::{RedisClientRegistry, RedisInflightAuth},
};

/// Postgres-backed broker state that still reads, and partly writes, the
/// legacy Redis store during the cutover.
#[derive(Clone)]
pub struct RedisCutoverAuthStore<C = RedisClientRegistry, I = RedisInflightAuth> {
    postgres: PostgresAuthStore,
    legacy_clients: Arc<C>,
    legacy_inflight: Arc<I>,
}

impl<C, I> RedisCutoverAuthStore<C, I> {
    /// Creates a store of record in `postgres` that falls back to the legacy
    /// stores.
    pub fn new(
        postgres: PostgresAuthStore,
        legacy_clients: Arc<C>,
        legacy_inflight: Arc<I>,
    ) -> Self {
        Self {
            postgres,
            legacy_clients,
            legacy_inflight,
        }
    }
}

fn log_legacy_error(operation: &'static str, error: &anyhow::Error) {
    tracing::warn!(error = ?error, operation, "legacy Redis MCP OAuth store failed");
}

impl<C, I> ClientRegistrationStore for RedisCutoverAuthStore<C, I>
where
    C: ClientRegistrationStore + RefreshTokenBindingStore + 'static,
    I: Send + Sync + 'static,
{
    fn insert_client<'a>(&'a self, client: &'a RegisteredClient) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.postgres.insert_client(client).await?;
            if let Err(error) = self.legacy_clients.insert_client(client).await {
                log_legacy_error("insert_client", &error);
            }
            Ok(())
        })
    }

    fn find_client<'a>(&'a self, client_id: &'a str) -> RegisteredClientFuture<'a> {
        Box::pin(async move {
            if let Some(client) = self.postgres.find_client(client_id).await? {
                return Ok(Some(client));
            }
            let legacy = match self.legacy_clients.find_client(client_id).await {
                Ok(legacy) => legacy,
                Err(error) => {
                    log_legacy_error("find_client", &error);
                    None
                }
            };
            let Some(client) = legacy else {
                return Ok(None);
            };
            tracing::info!(%client_id, "copied MCP OAuth client registration from legacy Redis");
            // The Redis read just re-armed its TTL, so the copy gets a full one.
            self.postgres
                .import_client(&client, CLIENT_REGISTRATION_TTL)
                .await?;
            Ok(Some(client))
        })
    }
}

impl<C, I> RefreshTokenBindingStore for RedisCutoverAuthStore<C, I>
where
    C: ClientRegistrationStore + RefreshTokenBindingStore + 'static,
    I: Send + Sync + 'static,
{
    fn bind<'a>(
        &'a self,
        refresh_token_digest: &'a str,
        binding: &'a RefreshTokenBinding,
    ) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.postgres.bind(refresh_token_digest, binding).await?;
            if let Err(error) = self
                .legacy_clients
                .bind(refresh_token_digest, binding)
                .await
            {
                log_legacy_error("bind", &error);
            }
            Ok(())
        })
    }

    fn binding<'a>(&'a self, refresh_token_digest: &'a str) -> RefreshTokenBindingFuture<'a> {
        Box::pin(async move {
            if let Some(binding) = self.postgres.binding(refresh_token_digest).await? {
                return Ok(Some(binding));
            }
            let legacy = match self.legacy_clients.binding(refresh_token_digest).await {
                Ok(legacy) => legacy,
                Err(error) => {
                    log_legacy_error("binding", &error);
                    None
                }
            };
            let Some(binding) = legacy else {
                return Ok(None);
            };
            tracing::info!(
                client_id = %binding.client_id,
                grant_id = %binding.grant_id,
                "copied MCP OAuth refresh token binding from legacy Redis"
            );
            // A full TTL, not the Redis remainder: the refresh that asked for
            // this binding is about to re-bind its successor anyway.
            self.postgres
                .import_binding(refresh_token_digest, &binding, REFRESH_TOKEN_BINDING_TTL)
                .await?;
            Ok(Some(binding))
        })
    }

    fn unbind<'a>(&'a self, refresh_token_digest: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            // Redis first: once Postgres has dropped the binding, a lookup
            // must not find the Redis copy and bring it back.
            if let Err(error) = self.legacy_clients.unbind(refresh_token_digest).await {
                log_legacy_error("unbind", &error);
            }
            self.postgres.unbind(refresh_token_digest).await
        })
    }

    fn revoke_grant<'a>(&'a self, grant_id: &'a str) -> StoreWriteFuture<'a> {
        Box::pin(async move {
            self.postgres.revoke_grant(grant_id).await?;
            // Mirrored so replicas still on the Redis-only build refuse the
            // family too.
            if let Err(error) = self.legacy_clients.revoke_grant(grant_id).await {
                log_legacy_error("revoke_grant", &error);
            }
            Ok(())
        })
    }

    fn is_grant_revoked<'a>(&'a self, grant_id: &'a str) -> GrantRevokedFuture<'a> {
        Box::pin(async move {
            if self.postgres.is_grant_revoked(grant_id).await? {
                return Ok(true);
            }
            // A replica on the Redis-only build records revocations there.
            let revoked = match self.legacy_clients.is_grant_revoked(grant_id).await {
                Ok(revoked) => revoked,
                Err(error) => {
                    log_legacy_error("is_grant_revoked", &error);
                    false
                }
            };
            if revoked {
                tracing::info!(%grant_id, "copied MCP OAuth grant revocation from legacy Redis");
                self.postgres
                    .import_revoked_grant(grant_id, REVOKED_GRANT_TTL)
                    .await?;
            }
            Ok(revoked)
        })
    }
}

impl<C, I> InflightAuthStore for RedisCutoverAuthStore<C, I>
where
    C: Send + Sync + 'static,
    I: InflightAuthStore + 'static,
{
    async fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> anyhow::Result<()> {
        self.postgres.insert_pending(session_id, pending).await
    }

    async fn take_pending(&self, session_id: &str) -> anyhow::Result<Option<PendingAuthorization>> {
        if let Some(pending) = self.postgres.take_pending(session_id).await? {
            return Ok(Some(pending));
        }
        self.legacy_inflight
            .take_pending(session_id)
            .await
            .or_else(|error| {
                log_legacy_error("take_pending", &error);
                Ok(None)
            })
    }

    async fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> anyhow::Result<()> {
        self.postgres.insert_issued(code, issued).await
    }

    async fn take_issued(&self, code: &str) -> anyhow::Result<Option<IssuedAuthorizationCode>> {
        if let Some(issued) = self.postgres.take_issued(code).await? {
            return Ok(Some(issued));
        }
        self.legacy_inflight
            .take_issued(code)
            .await
            .or_else(|error| {
                log_legacy_error("take_issued", &error);
                Ok(None)
            })
    }

    async fn cleanup_expired(&self) -> anyhow::Result<()> {
        self.postgres.cleanup_expired().await
    }
}

/// Copies every registration, refresh token binding, and grant revocation
/// still in Redis into Postgres, keeping the time each had left.
///
/// Safe to run on every replica at once and to repeat: a row already in
/// Postgres is left as it is.
#[tracing::instrument(
    name = "mcp_oauth.backfill_from_redis",
    skip_all,
    err,
    fields(
        clients = tracing::field::Empty,
        bindings = tracing::field::Empty,
        revoked_grants = tracing::field::Empty
    )
)]
pub async fn backfill_from_redis(
    legacy: &RedisClientRegistry,
    postgres: &PostgresAuthStore,
) -> anyhow::Result<()> {
    let clients = legacy.export_clients().await?;
    let client_count = clients.len();
    for (client, remaining) in clients {
        postgres.import_client(&client, remaining).await?;
    }
    // Revocations before bindings, so no binding of a revoked family is
    // honored in Postgres before its revocation is.
    let revoked_grants = legacy.export_revoked_grants().await?;
    let revoked_grant_count = revoked_grants.len();
    for (grant_id, remaining) in revoked_grants {
        postgres.import_revoked_grant(&grant_id, remaining).await?;
    }
    let bindings = legacy.export_bindings().await?;
    let binding_count = bindings.len();
    for (digest, binding, remaining) in bindings {
        postgres
            .import_binding(&digest, &binding, remaining)
            .await?;
    }
    tracing::Span::current()
        .record("clients", client_count)
        .record("bindings", binding_count)
        .record("revoked_grants", revoked_grant_count);
    tracing::info!(
        clients = client_count,
        bindings = binding_count,
        revoked_grants = revoked_grant_count,
        "backfilled MCP OAuth state from legacy Redis"
    );
    Ok(())
}
