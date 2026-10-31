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
    Connection, ConnectionStatus, CustomerApiKey, Envelope, Error, Grant, GrantCipher, GrantData,
    Repository,
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
