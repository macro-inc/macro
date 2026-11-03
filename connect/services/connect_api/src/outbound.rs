use std::{collections::HashMap, sync::Arc};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use aws_sdk_kms::{primitives::Blob, types::DataKeySpec};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use rand::RngCore as _;
use sha2::{Digest as _, Sha256};
use sqlx::PgPool;
use subtle::ConstantTimeEq as _;
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(test)]
use crate::domain::StoredGrant;
use crate::domain::{
    AppConnectionsSummary, Connection, ConnectionPosition, ConnectionStatus, ConnectionsSummary,
    CustomerApiKey, Envelope, Error, Grant, GrantCipher, GrantData, ListedConnection, ListedUser,
    Repository, UserPosition,
};

pub mod mcp;
pub mod oauth;
pub mod oauth_store;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

fn storage(error: sqlx::Error) -> Error {
    Error::Storage(rootcause::Report::new(error).into_dynamic())
}

pub struct PostgresRepository {
    pool: PgPool,
}

impl PostgresRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[cfg(test)]
    pub async fn create_customer(&self, name: &str) -> Result<CustomerApiKey, Error> {
        self.create_customer_with_origins(name, &[]).await
    }

    #[expect(
        clippy::disallowed_methods,
        reason = "Connect's own database uses runtime-checked queries per connect/docs/decisions.md"
    )]
    pub async fn create_customer_with_origins(
        &self,
        name: &str,
        origins: &[String],
    ) -> Result<CustomerApiKey, Error> {
        let customer_id = Uuid::now_v7();
        let key_id = Uuid::now_v7();
        let mut secret_bytes = Zeroizing::new([0_u8; 32]);
        rand::rng().fill_bytes(&mut *secret_bytes);
        let secret =
            Zeroizing::new(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(*secret_bytes));
        let key = CustomerApiKey::new(format!("ck_{key_id}_{}", secret.as_str()))?;
        let hash = Sha256::digest(secret.as_bytes());
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query(
            "INSERT INTO customers (id, name, allowed_redirect_origins) VALUES ($1, $2, $3)",
        )
        .bind(customer_id)
        .bind(name)
        .bind(origins)
        .execute(&mut *transaction)
        .await
        .map_err(storage)?;
        sqlx::query("INSERT INTO customer_api_keys (id, customer_id, key_hash, prefix) VALUES ($1, $2, $3, $4)")
            .bind(key_id).bind(customer_id).bind(&hash[..]).bind(&key.as_str()[..8])
            .execute(&mut *transaction).await.map_err(storage)?;
        transaction.commit().await.map_err(storage)?;
        Ok(key)
    }

    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "T006 stores OAuth grants through this method")
    )]
    #[expect(
        clippy::disallowed_methods,
        reason = "Connect has its own database and uses runtime-checked SQLx queries per connect/docs/decisions.md"
    )]
    pub async fn insert_connection(
        &self,
        id: Uuid,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
        scopes: &[String],
        envelope: &Envelope,
    ) -> Result<(), Error> {
        let mut transaction = self.pool.begin().await.map_err(storage)?;
        sqlx::query("INSERT INTO connections (id, customer_id, external_user_id, app_id, status, scopes) VALUES ($1, $2, $3, $4, 'active', $5)")
            .bind(id).bind(customer_id).bind(user_id).bind(app_id).bind(scopes)
            .execute(&mut *transaction).await.map_err(storage)?;
        sqlx::query("INSERT INTO grants (connection_id, ciphertext, nonce, encrypted_data_key, kms_key_id, encryption_version, access_token_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)")
            .bind(id).bind(&envelope.ciphertext).bind(&envelope.nonce).bind(&envelope.encrypted_data_key)
            .bind(&envelope.kms_key_id).bind(envelope.encryption_version).bind(envelope.access_token_expires_at)
            .execute(&mut *transaction).await.map_err(storage)?;
        transaction.commit().await.map_err(storage)?;
        Ok(())
    }
}

#[derive(sqlx::FromRow)]
struct KeyRow {
    customer_id: Uuid,
    key_hash: Vec<u8>,
}

#[derive(sqlx::FromRow)]
struct ConnectionRow {
    app_id: String,
    status: String,
    scopes: Vec<String>,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ListedConnectionRow {
    id: Uuid,
    external_user_id: String,
    app_id: String,
    status: String,
    scopes: Vec<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct ListedUserRow {
    first_connected_at: DateTime<Utc>,
    id: Uuid,
    external_user_id: String,
    app_id: String,
    status: String,
    scopes: Vec<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct SummaryRow {
    users: i64,
    connections: i64,
    needs_reauth: i64,
}

#[derive(sqlx::FromRow)]
struct AppSummaryRow {
    app_id: String,
    active: i64,
    needs_reauth: i64,
}

#[cfg(test)]
#[derive(sqlx::FromRow)]
struct GrantRow {
    connection_id: Uuid,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    encrypted_data_key: Vec<u8>,
    kms_key_id: String,
    encryption_version: i16,
    access_token_expires_at: Option<DateTime<Utc>>,
}

#[async_trait::async_trait]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect has its own database and uses runtime-checked SQLx queries per connect/docs/decisions.md"
)]
impl Repository for PostgresRepository {
    async fn authenticate(&self, key: &str) -> Result<Uuid, Error> {
        let (id, secret) = key
            .strip_prefix("ck_")
            .and_then(|value| value.split_once('_'))
            .ok_or(Error::InvalidKey)?;
        let id = Uuid::parse_str(id).map_err(|_| Error::InvalidKey)?;
        let row = sqlx::query_as::<_, KeyRow>("SELECT customer_id, key_hash FROM customer_api_keys WHERE id = $1 AND revoked_at IS NULL")
            .bind(id).fetch_optional(&self.pool).await.map_err(storage)?.ok_or(Error::InvalidKey)?;
        let actual = Sha256::digest(secret.as_bytes());
        if row.key_hash.len() != 32 || !bool::from(actual[..].ct_eq(&row.key_hash)) {
            return Err(Error::InvalidKey);
        }
        Ok(row.customer_id)
    }

    async fn list(&self, customer_id: Uuid, user_id: &str) -> Result<Vec<Connection>, Error> {
        let rows = sqlx::query_as::<_, ConnectionRow>("SELECT app_id, status, scopes, created_at FROM connections WHERE customer_id = $1 AND external_user_id = $2 ORDER BY app_id")
            .bind(customer_id).bind(user_id).fetch_all(&self.pool).await.map_err(storage)?;
        rows.into_iter()
            .map(|row| {
                Ok(Connection {
                    app_id: row.app_id,
                    status: row.status.parse::<ConnectionStatus>().map_err(|error| {
                        Error::Storage(rootcause::Report::new(error).into_dynamic())
                    })?,
                    scopes: row.scopes,
                    created_at: row.created_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(name = "connect.db.list_customer_connections", skip_all, fields(customer_id = %customer_id, count), err)]
    async fn list_customer_connections(
        &self,
        customer_id: Uuid,
        limit: i64,
        position: Option<ConnectionPosition>,
        app_id: Option<&str>,
        status: Option<ConnectionStatus>,
    ) -> Result<Vec<ListedConnection>, Error> {
        let time = position.as_ref().map(|position| position.created_at);
        let id = position.as_ref().map(|position| position.id);
        let status = status.map(|status| status.to_string());
        let rows = sqlx::query_as::<_, ListedConnectionRow>(
            "SELECT c.id, c.external_user_id, c.app_id, c.status, c.scopes, c.created_at, c.updated_at, g.access_token_expires_at \
             FROM connections c LEFT JOIN grants g ON g.connection_id = c.id \
             WHERE c.customer_id = $1 AND ($2::timestamptz IS NULL OR (c.created_at, c.id) < ($2, $3)) \
             AND ($4::text IS NULL OR c.app_id = $4) AND ($5::text IS NULL OR c.status = $5) \
             ORDER BY c.created_at DESC, c.id DESC LIMIT $6"
        ).bind(customer_id).bind(time).bind(id).bind(app_id).bind(status).bind(limit)
            .fetch_all(&self.pool).await.map_err(storage)?;
        tracing::Span::current().record("count", rows.len());
        rows.into_iter()
            .map(|row| {
                Ok(ListedConnection {
                    id: row.id,
                    external_user_id: row.external_user_id,
                    app_id: row.app_id,
                    status: row.status.parse().map_err(|error| {
                        Error::Storage(rootcause::Report::new(error).into_dynamic())
                    })?,
                    scopes: row.scopes,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    access_token_expires_at: row.access_token_expires_at,
                })
            })
            .collect()
    }

    #[tracing::instrument(name = "connect.db.list_users", skip_all, fields(customer_id = %customer_id, count), err)]
    async fn list_users(
        &self,
        customer_id: Uuid,
        limit: i64,
        position: Option<UserPosition>,
        app_id: Option<&str>,
        status: Option<ConnectionStatus>,
    ) -> Result<Vec<ListedUser>, Error> {
        let time = position
            .as_ref()
            .map(|position| position.first_connected_at);
        let user_id = position
            .as_ref()
            .map(|position| position.external_user_id.as_str());
        let status = status.map(|status| status.to_string());
        let rows = sqlx::query_as::<_, ListedUserRow>(
            "WITH matching AS ( \
               SELECT external_user_id, MIN(created_at) AS first_connected_at \
               FROM connections WHERE customer_id = $1 \
               GROUP BY external_user_id \
               HAVING BOOL_OR(($4::text IS NULL OR app_id = $4) AND ($5::text IS NULL OR status = $5)) \
             ), page AS ( \
               SELECT external_user_id, first_connected_at FROM matching \
               WHERE $2::timestamptz IS NULL OR (first_connected_at, external_user_id) < ($2, $3) \
               ORDER BY first_connected_at DESC, external_user_id DESC LIMIT $6 \
             ) \
             SELECT page.first_connected_at, c.id, c.external_user_id, c.app_id, c.status, c.scopes, \
                    c.created_at, c.updated_at, g.access_token_expires_at \
             FROM page JOIN connections c ON c.customer_id = $1 AND c.external_user_id = page.external_user_id \
             LEFT JOIN grants g ON g.connection_id = c.id \
             ORDER BY page.first_connected_at DESC, page.external_user_id DESC, c.app_id"
        ).bind(customer_id).bind(time).bind(user_id).bind(app_id).bind(status).bind(limit)
            .fetch_all(&self.pool).await.map_err(storage)?;
        let mut users: Vec<ListedUser> = Vec::new();
        for row in rows {
            if users
                .last()
                .is_none_or(|user| user.external_user_id != row.external_user_id)
            {
                users.push(ListedUser {
                    external_user_id: row.external_user_id.clone(),
                    first_connected_at: row.first_connected_at,
                    connections: Vec::new(),
                });
            }
            if let Some(user) = users.last_mut() {
                user.connections.push(ListedConnection {
                    id: row.id,
                    external_user_id: row.external_user_id,
                    app_id: row.app_id,
                    status: row.status.parse().map_err(|error| {
                        Error::Storage(rootcause::Report::new(error).into_dynamic())
                    })?,
                    scopes: row.scopes,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    access_token_expires_at: row.access_token_expires_at,
                });
            }
        }
        tracing::Span::current().record("count", users.len());
        Ok(users)
    }

    #[tracing::instrument(name = "connect.db.connections_summary", skip_all, fields(customer_id = %customer_id), err)]
    async fn connections_summary(&self, customer_id: Uuid) -> Result<ConnectionsSummary, Error> {
        let row = sqlx::query_as::<_, SummaryRow>(
            "SELECT COUNT(DISTINCT external_user_id) AS users, COUNT(*) AS connections, \
             COUNT(*) FILTER (WHERE status = 'needs_reauth') AS needs_reauth \
             FROM connections WHERE customer_id = $1",
        )
        .bind(customer_id)
        .fetch_one(&self.pool)
        .await
        .map_err(storage)?;
        let apps = sqlx::query_as::<_, AppSummaryRow>(
            "SELECT app_id, COUNT(*) FILTER (WHERE status = 'active') AS active, \
             COUNT(*) FILTER (WHERE status = 'needs_reauth') AS needs_reauth \
             FROM connections WHERE customer_id = $1 GROUP BY app_id ORDER BY app_id",
        )
        .bind(customer_id)
        .fetch_all(&self.pool)
        .await
        .map_err(storage)?;
        let count = |value| {
            u64::try_from(value)
                .map_err(|error| Error::Storage(rootcause::Report::new(error).into_dynamic()))
        };
        Ok(ConnectionsSummary {
            users: count(row.users)?,
            connections: count(row.connections)?,
            needs_reauth: count(row.needs_reauth)?,
            apps: apps
                .into_iter()
                .map(|app| {
                    Ok(AppConnectionsSummary {
                        app_id: app.app_id,
                        active: count(app.active)?,
                        needs_reauth: count(app.needs_reauth)?,
                    })
                })
                .collect::<Result<_, Error>>()?,
        })
    }

    async fn delete(&self, customer_id: Uuid, user_id: &str, app_id: &str) -> Result<bool, Error> {
        let result = sqlx::query("DELETE FROM connections WHERE customer_id = $1 AND external_user_id = $2 AND app_id = $3")
            .bind(customer_id).bind(user_id).bind(app_id).execute(&self.pool).await.map_err(storage)?;
        Ok(result.rows_affected() != 0)
    }

    #[cfg(test)]
    async fn grant(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<Option<StoredGrant>, Error> {
        let row = sqlx::query_as::<_, GrantRow>("SELECT g.connection_id, g.ciphertext, g.nonce, g.encrypted_data_key, g.kms_key_id, g.encryption_version, g.access_token_expires_at FROM connections c JOIN grants g ON g.connection_id = c.id WHERE c.customer_id = $1 AND c.external_user_id = $2 AND c.app_id = $3")
            .bind(customer_id).bind(user_id).bind(app_id).fetch_optional(&self.pool).await.map_err(storage)?;
        Ok(row.map(|row| StoredGrant {
            connection_id: row.connection_id,
            envelope: Envelope {
                ciphertext: row.ciphertext,
                nonce: row.nonce,
                encrypted_data_key: row.encrypted_data_key,
                kms_key_id: row.kms_key_id,
                encryption_version: row.encryption_version,
                access_token_expires_at: row.access_token_expires_at,
            },
        }))
    }
}

pub struct DataKey {
    plaintext: Zeroizing<Vec<u8>>,
    encrypted: Vec<u8>,
    key_id: String,
}

#[async_trait::async_trait]
pub trait KeyWrapper: Send + Sync {
    async fn generate(&self, customer_id: Uuid, connection_id: Uuid) -> Result<DataKey, Error>;
    async fn unwrap(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        key_id: &str,
        encrypted: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, Error>;
}

fn context(customer_id: Uuid, connection_id: Uuid) -> HashMap<String, String> {
    HashMap::from([
        ("customer_id".into(), customer_id.to_string()),
        ("connection_id".into(), connection_id.to_string()),
    ])
}

fn aad(customer_id: Uuid, connection_id: Uuid) -> Vec<u8> {
    format!("connect-grant-v1:{customer_id}:{connection_id}").into_bytes()
}

pub struct KmsKeyWrapper {
    client: aws_sdk_kms::Client,
    key_id: String,
}
impl KmsKeyWrapper {
    pub fn new(client: aws_sdk_kms::Client, key_id: String) -> Self {
        Self { client, key_id }
    }
}

#[async_trait::async_trait]
impl KeyWrapper for KmsKeyWrapper {
    async fn generate(&self, customer_id: Uuid, connection_id: Uuid) -> Result<DataKey, Error> {
        let output = self
            .client
            .generate_data_key()
            .key_id(&self.key_id)
            .key_spec(DataKeySpec::Aes256)
            .set_encryption_context(Some(context(customer_id, connection_id)))
            .send()
            .await
            .map_err(|_| Error::Cipher)?;
        Ok(DataKey {
            plaintext: Zeroizing::new(output.plaintext().ok_or(Error::Cipher)?.as_ref().to_vec()),
            encrypted: output
                .ciphertext_blob()
                .ok_or(Error::Cipher)?
                .as_ref()
                .to_vec(),
            key_id: output.key_id().ok_or(Error::Cipher)?.to_owned(),
        })
    }
    async fn unwrap(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        key_id: &str,
        encrypted: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        let output = self
            .client
            .decrypt()
            .key_id(key_id)
            .ciphertext_blob(Blob::new(encrypted))
            .set_encryption_context(Some(context(customer_id, connection_id)))
            .send()
            .await
            .map_err(|_| Error::Cipher)?;
        Ok(Zeroizing::new(
            output.plaintext().ok_or(Error::Cipher)?.as_ref().to_vec(),
        ))
    }
}

pub struct LocalKeyWrapper {
    key: Zeroizing<[u8; 32]>,
}
impl LocalKeyWrapper {
    pub fn from_base64(value: &str) -> Result<Self, Error> {
        let bytes = Zeroizing::new(STANDARD.decode(value).map_err(|_| Error::Cipher)?);
        let key: [u8; 32] = bytes.as_slice().try_into().map_err(|_| Error::Cipher)?;
        Ok(Self {
            key: Zeroizing::new(key),
        })
    }
}

#[async_trait::async_trait]
impl KeyWrapper for LocalKeyWrapper {
    async fn generate(&self, customer_id: Uuid, connection_id: Uuid) -> Result<DataKey, Error> {
        let mut plaintext = Zeroizing::new(vec![0_u8; 32]);
        rand::rng().fill_bytes(&mut plaintext);
        let cipher = Aes256Gcm::new_from_slice(&*self.key).map_err(|_| Error::Cipher)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &aad(customer_id, connection_id),
                },
            )
            .map_err(|_| Error::Cipher)?;
        let mut encrypted = nonce.to_vec();
        encrypted.extend(ciphertext);
        Ok(DataKey {
            plaintext,
            encrypted,
            key_id: "local".into(),
        })
    }
    async fn unwrap(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        key_id: &str,
        encrypted: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, Error> {
        if key_id != "local" || encrypted.len() < 28 {
            return Err(Error::Cipher);
        }
        let nonce: [u8; 12] = encrypted[..12].try_into().map_err(|_| Error::Cipher)?;
        let cipher = Aes256Gcm::new_from_slice(&*self.key).map_err(|_| Error::Cipher)?;
        let plaintext = cipher
            .decrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: &encrypted[12..],
                    aad: &aad(customer_id, connection_id),
                },
            )
            .map_err(|_| Error::Cipher)?;
        Ok(Zeroizing::new(plaintext))
    }
}

pub struct EnvelopeCipher {
    wrapper: Arc<dyn KeyWrapper>,
}
impl EnvelopeCipher {
    pub fn new(wrapper: Arc<dyn KeyWrapper>) -> Self {
        Self { wrapper }
    }
}

#[async_trait::async_trait]
impl GrantCipher for EnvelopeCipher {
    async fn seal(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        grant: &Grant,
    ) -> Result<Envelope, Error> {
        let key = self.wrapper.generate(customer_id, connection_id).await?;
        let cipher = Aes256Gcm::new_from_slice(&key.plaintext).map_err(|_| Error::Cipher)?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plaintext =
            Zeroizing::new(serde_json::to_vec(&GrantData::from(grant)).map_err(|_| Error::Cipher)?);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &aad(customer_id, connection_id),
                },
            )
            .map_err(|_| Error::Cipher)?;
        Ok(Envelope {
            ciphertext,
            nonce: nonce.to_vec(),
            encrypted_data_key: key.encrypted,
            kms_key_id: key.key_id,
            encryption_version: 1,
            access_token_expires_at: grant.expires_at,
        })
    }
    async fn open(
        &self,
        customer_id: Uuid,
        connection_id: Uuid,
        envelope: &Envelope,
    ) -> Result<Grant, Error> {
        if envelope.encryption_version != 1
            || envelope.nonce.len() != 12
            || envelope.ciphertext.len() < 16
        {
            return Err(Error::Cipher);
        }
        let key = self
            .wrapper
            .unwrap(
                customer_id,
                connection_id,
                &envelope.kms_key_id,
                &envelope.encrypted_data_key,
            )
            .await?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| Error::Cipher)?;
        let nonce: [u8; 12] = envelope
            .nonce
            .as_slice()
            .try_into()
            .map_err(|_| Error::Cipher)?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    &Nonce::from(nonce),
                    Payload {
                        msg: &envelope.ciphertext,
                        aad: &aad(customer_id, connection_id),
                    },
                )
                .map_err(|_| Error::Cipher)?,
        );
        let data: GrantData = serde_json::from_slice(&plaintext).map_err(|_| Error::Cipher)?;
        Ok(data.into())
    }
}

#[cfg(test)]
mod test;
