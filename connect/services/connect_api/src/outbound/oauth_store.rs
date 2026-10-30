use chrono::{DateTime, Utc};
use connect_registry::ClientRegistration;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{PostgresRepository, storage};
use crate::domain::{
    Envelope, Error, Grant, StoredGrant,
    oauth::{
        LockedClient, LockedGrant, LockedGrantRecord, OAuthClientRecord, OAuthRepository,
        OAuthState, PendingConnection, Session, TakenState, registration_name,
    },
};

#[derive(sqlx::FromRow)]
struct SessionRow {
    token: String,
    customer_id: Uuid,
    external_user_id: String,
    app_id: String,
    redirect_url: String,
    expires_at: DateTime<Utc>,
    session_traceparent: Option<String>,
}

impl From<SessionRow> for Session {
    fn from(row: SessionRow) -> Self {
        Self {
            token: row.token,
            customer_id: row.customer_id,
            user_id: row.external_user_id,
            app_id: row.app_id,
            redirect_url: row.redirect_url,
            expires_at: row.expires_at,
            traceparent: row.session_traceparent,
        }
    }
}

#[derive(sqlx::FromRow)]
struct StateRow {
    state: String,
    customer_id: Uuid,
    external_user_id: String,
    app_id: String,
    redirect_url: String,
    client_id: String,
    issuer: String,
    registration_kind: String,
    verifier_ciphertext: Vec<u8>,
    verifier_nonce: Vec<u8>,
    verifier_encrypted_data_key: Vec<u8>,
    verifier_kms_key_id: String,
    verifier_encryption_version: i16,
    expires_at: DateTime<Utc>,
    consumed_at: Option<DateTime<Utc>>,
    authorize_traceparent: Option<String>,
}

fn parse_kind(value: &str) -> Result<ClientRegistration, Error> {
    match value {
        "cimd" => Ok(ClientRegistration::Cimd),
        "dcr" => Ok(ClientRegistration::Dcr),
        "own_app" => Ok(ClientRegistration::OwnApp),
        _ => Err(Error::OAuth),
    }
}

impl TryFrom<StateRow> for OAuthState {
    type Error = Error;
    fn try_from(row: StateRow) -> Result<Self, Error> {
        Ok(Self {
            state: row.state,
            customer_id: row.customer_id,
            user_id: row.external_user_id,
            app_id: row.app_id,
            redirect_url: row.redirect_url,
            client_id: row.client_id,
            issuer: row.issuer,
            kind: parse_kind(&row.registration_kind)?,
            verifier: Envelope {
                ciphertext: row.verifier_ciphertext,
                nonce: row.verifier_nonce,
                encrypted_data_key: row.verifier_encrypted_data_key,
                kms_key_id: row.verifier_kms_key_id,
                encryption_version: row.verifier_encryption_version,
                access_token_expires_at: None,
            },
            expires_at: row.expires_at,
            traceparent: row.authorize_traceparent,
        })
    }
}

const STATE_COLUMNS: &str = "state, customer_id, external_user_id, app_id, redirect_url, client_id, issuer, registration_kind, verifier_ciphertext, verifier_nonce, verifier_encrypted_data_key, verifier_kms_key_id, verifier_encryption_version, expires_at, consumed_at, authorize_traceparent";

#[derive(sqlx::FromRow)]
struct ClientRow {
    client_id: String,
    secret_ciphertext: Option<Vec<u8>>,
    secret_nonce: Option<Vec<u8>>,
    secret_encrypted_data_key: Option<Vec<u8>>,
    secret_kms_key_id: Option<String>,
    secret_encryption_version: Option<i16>,
}

struct ClientLock {
    transaction: Transaction<'static, Postgres>,
    issuer: String,
    redirect_uri: String,
}

#[async_trait::async_trait]
impl LockedClient for ClientLock {
    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    async fn get(&mut self) -> Result<Option<OAuthClientRecord>, Error> {
        let row = sqlx::query_as::<_, ClientRow>("SELECT client_id, secret_ciphertext, secret_nonce, secret_encrypted_data_key, secret_kms_key_id, secret_encryption_version FROM oauth_clients WHERE issuer = $1 AND redirect_uri = $2")
            .bind(&self.issuer).bind(&self.redirect_uri).fetch_optional(&mut *self.transaction).await.map_err(storage)?;
        row.map(|row| {
            let secret = match (
                row.secret_ciphertext,
                row.secret_nonce,
                row.secret_encrypted_data_key,
                row.secret_kms_key_id,
                row.secret_encryption_version,
            ) {
                (
                    Some(ciphertext),
                    Some(nonce),
                    Some(encrypted_data_key),
                    Some(kms_key_id),
                    Some(encryption_version),
                ) => Some(Envelope {
                    ciphertext,
                    nonce,
                    encrypted_data_key,
                    kms_key_id,
                    encryption_version,
                    access_token_expires_at: None,
                }),
                (None, None, None, None, None) => None,
                _ => return Err(Error::Cipher),
            };
            Ok(OAuthClientRecord {
                id: row.client_id,
                secret,
            })
        })
        .transpose()
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    async fn insert(&mut self, client: OAuthClientRecord) -> Result<(), Error> {
        let secret = client.secret.as_ref();
        sqlx::query("INSERT INTO oauth_clients (issuer, redirect_uri, client_id, secret_ciphertext, secret_nonce, secret_encrypted_data_key, secret_kms_key_id, secret_encryption_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (issuer, redirect_uri) DO NOTHING")
            .bind(&self.issuer).bind(&self.redirect_uri).bind(&client.id)
            .bind(secret.map(|value| &value.ciphertext)).bind(secret.map(|value| &value.nonce))
            .bind(secret.map(|value| &value.encrypted_data_key)).bind(secret.map(|value| &value.kms_key_id))
            .bind(secret.map(|value| value.encryption_version))
            .execute(&mut *self.transaction).await.map_err(storage)?;
        Ok(())
    }

    async fn commit(self: Box<Self>) -> Result<(), Error> {
        self.transaction.commit().await.map_err(storage)
    }
}

#[derive(sqlx::FromRow)]
struct LockedGrantRow {
    connection_id: Uuid,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_data_key: Vec<u8>,
    kms_key_id: String,
    encryption_version: i16,
    access_token_expires_at: Option<DateTime<Utc>>,
    oauth_issuer: Option<String>,
    oauth_client_id: Option<String>,
    oauth_registration_kind: Option<String>,
    status: String,
}

struct GrantLock {
    transaction: Transaction<'static, Postgres>,
    record: LockedGrantRecord,
}

#[async_trait::async_trait]
impl LockedGrant for GrantLock {
    fn record(&self) -> &LockedGrantRecord {
        &self.record
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    async fn save(&mut self, envelope: &Envelope, scopes: &[String]) -> Result<(), Error> {
        sqlx::query("UPDATE grants SET ciphertext = $2, nonce = $3, encrypted_data_key = $4, kms_key_id = $5, encryption_version = $6, access_token_expires_at = $7, updated_at = now() WHERE connection_id = $1")
            .bind(self.record.stored.connection_id).bind(&envelope.ciphertext).bind(&envelope.nonce).bind(&envelope.encrypted_data_key)
            .bind(&envelope.kms_key_id).bind(envelope.encryption_version).bind(envelope.access_token_expires_at)
            .execute(&mut *self.transaction).await.map_err(storage)?;
        sqlx::query("UPDATE connections SET scopes = $2, updated_at = now() WHERE id = $1")
            .bind(self.record.stored.connection_id)
            .bind(scopes)
            .execute(&mut *self.transaction)
            .await
            .map_err(storage)?;
        Ok(())
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    async fn needs_reauth(&mut self) -> Result<(), Error> {
        sqlx::query(
            "UPDATE connections SET status = 'needs_reauth', updated_at = now() WHERE id = $1",
        )
        .bind(self.record.stored.connection_id)
        .execute(&mut *self.transaction)
        .await
        .map_err(storage)?;
        Ok(())
    }

    async fn commit(self: Box<Self>) -> Result<(), Error> {
        self.transaction.commit().await.map_err(storage)
    }
}

struct ConnectionLock {
    transaction: Transaction<'static, Postgres>,
    id: Uuid,
}

#[async_trait::async_trait]
impl PendingConnection for ConnectionLock {
    fn id(&self) -> Uuid {
        self.id
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    async fn save(
        &mut self,
        state: &OAuthState,
        grant: &Grant,
        envelope: &Envelope,
    ) -> Result<(), Error> {
        sqlx::query("INSERT INTO connections (id, customer_id, external_user_id, app_id, status, scopes, oauth_issuer, oauth_client_id, oauth_registration_kind) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8) ON CONFLICT (customer_id, external_user_id, app_id) DO UPDATE SET status = 'active', scopes = EXCLUDED.scopes, oauth_issuer = EXCLUDED.oauth_issuer, oauth_client_id = EXCLUDED.oauth_client_id, oauth_registration_kind = EXCLUDED.oauth_registration_kind, updated_at = now()")
            .bind(self.id).bind(state.customer_id).bind(&state.user_id).bind(&state.app_id).bind(&grant.scopes)
            .bind(&state.issuer).bind(&state.client_id).bind(registration_name(state.kind))
            .execute(&mut *self.transaction).await.map_err(storage)?;
        sqlx::query("INSERT INTO grants (connection_id, ciphertext, nonce, encrypted_data_key, kms_key_id, encryption_version, access_token_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (connection_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, encrypted_data_key = EXCLUDED.encrypted_data_key, kms_key_id = EXCLUDED.kms_key_id, encryption_version = EXCLUDED.encryption_version, access_token_expires_at = EXCLUDED.access_token_expires_at, updated_at = now()")
            .bind(self.id).bind(&envelope.ciphertext).bind(&envelope.nonce).bind(&envelope.encrypted_data_key).bind(&envelope.kms_key_id)
            .bind(envelope.encryption_version).bind(envelope.access_token_expires_at)
            .execute(&mut *self.transaction).await.map_err(storage)?;
        Ok(())
    }

    async fn commit(self: Box<Self>) -> Result<(), Error> {
        self.transaction.commit().await.map_err(storage)
    }
}

#[async_trait::async_trait]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
)]
impl OAuthRepository for PostgresRepository {
    async fn allowed_origins(&self, customer_id: Uuid) -> Result<Vec<String>, Error> {
        sqlx::query_scalar("SELECT allowed_redirect_origins FROM customers WHERE id = $1")
            .bind(customer_id)
            .fetch_one(&self.pool)
            .await
            .map_err(storage)
    }

    async fn create_session(&self, session: &Session) -> Result<(), Error> {
        sqlx::query("DELETE FROM connect_sessions WHERE token IN (SELECT token FROM connect_sessions WHERE expires_at < now() - interval '1 day' ORDER BY expires_at LIMIT 100)")
            .execute(&self.pool).await.map_err(storage)?;
        sqlx::query("DELETE FROM oauth_states WHERE state IN (SELECT state FROM oauth_states WHERE expires_at < now() - interval '1 day' ORDER BY expires_at LIMIT 100)")
            .execute(&self.pool).await.map_err(storage)?;
        sqlx::query("INSERT INTO connect_sessions (token, customer_id, external_user_id, app_id, redirect_url, expires_at, session_traceparent) VALUES ($1, $2, $3, $4, $5, $6, $7)")
            .bind(&session.token).bind(session.customer_id).bind(&session.user_id).bind(&session.app_id).bind(&session.redirect_url).bind(session.expires_at).bind(&session.traceparent)
            .execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }

    async fn get_session(&self, token: &str) -> Result<Option<Session>, Error> {
        let row = sqlx::query_as::<_, SessionRow>("SELECT token, customer_id, external_user_id, app_id, redirect_url, expires_at, session_traceparent FROM connect_sessions WHERE token = $1 AND expires_at > now()")
            .bind(token).fetch_optional(&self.pool).await.map_err(storage)?;
        Ok(row.map(Into::into))
    }

    async fn save_state(&self, state: &OAuthState) -> Result<(), Error> {
        sqlx::query("INSERT INTO oauth_states (state, customer_id, external_user_id, app_id, redirect_url, client_id, issuer, registration_kind, verifier_ciphertext, verifier_nonce, verifier_encrypted_data_key, verifier_kms_key_id, verifier_encryption_version, expires_at, authorize_traceparent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)")
            .bind(&state.state).bind(state.customer_id).bind(&state.user_id).bind(&state.app_id).bind(&state.redirect_url).bind(&state.client_id)
            .bind(&state.issuer).bind(registration_name(state.kind)).bind(&state.verifier.ciphertext).bind(&state.verifier.nonce)
            .bind(&state.verifier.encrypted_data_key).bind(&state.verifier.kms_key_id).bind(state.verifier.encryption_version).bind(state.expires_at).bind(&state.traceparent)
            .execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }

    async fn take_state(&self, state: &str) -> Result<Option<TakenState>, Error> {
        let update = format!(
            "UPDATE oauth_states SET consumed_at = now() WHERE state = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING {STATE_COLUMNS}"
        );
        if let Some(row) = sqlx::query_as::<_, StateRow>(&update)
            .bind(state)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?
        {
            return Ok(Some(TakenState::Valid(row.try_into()?)));
        }
        let select = format!("SELECT {STATE_COLUMNS} FROM oauth_states WHERE state = $1");
        let row = sqlx::query_as::<_, StateRow>(&select)
            .bind(state)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?;
        row.map(|row| {
            let reused = row.consumed_at.is_some();
            let state = row.try_into()?;
            Ok(if reused {
                TakenState::Reused(state)
            } else {
                TakenState::Expired(state)
            })
        })
        .transpose()
    }

    async fn lock_client(
        &self,
        issuer: &str,
        redirect_uri: &str,
    ) -> Result<Box<dyn LockedClient>, Error> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("{}:{issuer}{redirect_uri}", issuer.len()))
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        Ok(Box::new(ClientLock {
            transaction,
            issuer: issuer.into(),
            redirect_uri: redirect_uri.into(),
        }))
    }

    async fn lock_connection(
        &self,
        state: &OAuthState,
    ) -> Result<Box<dyn PendingConnection>, Error> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!(
                "{}:{}:{}:{}{}",
                state.customer_id,
                state.user_id.len(),
                state.user_id,
                state.app_id.len(),
                state.app_id
            ))
            .execute(&mut *transaction)
            .await
            .map_err(storage)?;
        let id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM connections WHERE customer_id = $1 AND external_user_id = $2 AND app_id = $3")
            .bind(state.customer_id).bind(&state.user_id).bind(&state.app_id)
            .fetch_optional(&mut *transaction).await.map_err(storage)?.unwrap_or_else(Uuid::now_v7);
        Ok(Box::new(ConnectionLock { transaction, id }))
    }

    async fn lock_grant(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<Option<Box<dyn LockedGrant>>, Error> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        let row = sqlx::query_as::<_, LockedGrantRow>("SELECT g.connection_id, g.ciphertext, g.nonce, g.encrypted_data_key, g.kms_key_id, g.encryption_version, g.access_token_expires_at, c.oauth_issuer, c.oauth_client_id, c.oauth_registration_kind, c.status FROM connections c JOIN grants g ON g.connection_id = c.id WHERE c.customer_id = $1 AND c.external_user_id = $2 AND c.app_id = $3 FOR UPDATE OF c, g")
            .bind(customer_id).bind(user_id).bind(app_id).fetch_optional(&mut *transaction).await.map_err(storage)?;
        row.map(|row| {
            Ok(Box::new(GrantLock {
                transaction,
                record: LockedGrantRecord {
                    stored: StoredGrant {
                        connection_id: row.connection_id,
                        envelope: Envelope {
                            ciphertext: row.ciphertext,
                            nonce: row.nonce,
                            encrypted_data_key: row.encrypted_data_key,
                            kms_key_id: row.kms_key_id,
                            encryption_version: row.encryption_version,
                            access_token_expires_at: row.access_token_expires_at,
                        },
                    },
                    needs_reauth: row.status == "needs_reauth",
                    issuer: row.oauth_issuer,
                    client_id: row.oauth_client_id,
                    kind: row
                        .oauth_registration_kind
                        .as_deref()
                        .map(parse_kind)
                        .transpose()?,
                },
            }) as Box<dyn LockedGrant>)
        })
        .transpose()
    }

    async fn set_redirect_origins(
        &self,
        customer_id: Uuid,
        origins: &[String],
    ) -> Result<bool, Error> {
        let result =
            sqlx::query("UPDATE customers SET allowed_redirect_origins = $2 WHERE id = $1")
                .bind(customer_id)
                .bind(origins)
                .execute(&self.pool)
                .await
                .map_err(storage)?;
        Ok(result.rows_affected() == 1)
    }
}
