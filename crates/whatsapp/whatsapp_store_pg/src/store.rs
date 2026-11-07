//! The device store of one linked account, and the row helpers every
//! whatsmeow store trait is built from.

mod app_state;
mod contacts;
mod device;
mod events;
mod lid;
mod signal;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;

use sqlx::{PgConnection, PgExecutor, PgPool, Postgres, Transaction};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::cipher::{ENCRYPTION_VERSION, StoreName, ValueCipher, WhatsAppDataKey};
use crate::error::WhatsAppStoreError;
use crate::kms::{WhatsAppKms, encryption_context};

/// Every whatsmeow store of one linked account, in Postgres.
///
/// Holds the account's data key in memory (see [`crate::cipher`]) and the
/// lease epoch the caller held when it opened the store. Every write runs in
/// a transaction that first checks the account still has that epoch, and
/// holds a share lock on the account row until it commits, so once a
/// takeover has bumped the epoch no write from the previous holder can land.
pub struct PgWhatsAppStore {
    pool: PgPool,
    account_id: Uuid,
    lease_epoch: i64,
    cipher: ValueCipher,
    /// Phone number Signal users already moved to their LID, as whatsmeow
    /// remembers them, so a migration runs once per user per process.
    migrated_pn_sessions: Mutex<HashSet<String>>,
}

impl std::fmt::Debug for PgWhatsAppStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PgWhatsAppStore")
            .field("account_id", &self.account_id)
            .field("lease_epoch", &self.lease_epoch)
            .finish_non_exhaustive()
    }
}

impl PgWhatsAppStore {
    /// Opens the store of `account_id` for the holder of `lease_epoch`.
    ///
    /// The first open of an account generates its data key (one KMS
    /// `GenerateDataKey`) and stores it wrapped; every later open unwraps it
    /// (one KMS `Decrypt`). The plaintext key then stays in memory only.
    ///
    /// # Errors
    /// [`WhatsAppStoreError::Fenced`] when the account's epoch is not
    /// `lease_epoch`, [`WhatsAppStoreError::Kms`] when KMS refuses, and
    /// database errors.
    #[tracing::instrument(
        name = "whatsapp_store.open",
        skip(pool, kms),
        fields(account_id = %account_id, lease_epoch, created),
        err
    )]
    pub async fn open(
        pool: PgPool,
        account_id: Uuid,
        lease_epoch: i64,
        kms: &impl WhatsAppKms,
    ) -> Result<Self, WhatsAppStoreError> {
        let account = sqlx::query!(
            r#"
            SELECT user_id, lease_epoch
            FROM whatsapp_linked_account
            WHERE id = $1
            "#,
            account_id,
        )
        .fetch_optional(&pool)
        .await?
        .ok_or(WhatsAppStoreError::AccountNotFound)?;
        if account.lease_epoch != lease_epoch {
            return Err(WhatsAppStoreError::Fenced);
        }
        let context = encryption_context(&account.user_id, account_id);

        let data_key = match read_wrapped_data_key(&pool, account_id).await? {
            Some(wrapped) => wrapped.unwrap(kms, context).await?,
            None => {
                let generated = kms.generate_data_key(context.clone()).await?;
                let mut transaction = pool.begin().await?;
                check_lease(&mut transaction, account_id, lease_epoch).await?;
                let inserted = sqlx::query_scalar!(
                    r#"
                    INSERT INTO whatsapp_device (
                        account_id,
                        data_key_ciphertext,
                        kms_key_id,
                        encryption_version
                    )
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (account_id) DO NOTHING
                    RETURNING account_id
                    "#,
                    account_id,
                    generated.ciphertext,
                    generated.kms_key_id,
                    ENCRYPTION_VERSION,
                )
                .fetch_optional(&mut *transaction)
                .await?;
                transaction.commit().await?;
                tracing::Span::current().record("created", inserted.is_some());
                match inserted {
                    Some(_) => WhatsAppDataKey::from_plaintext(&generated.plaintext)?,
                    // Another open created the device first: use its key.
                    None => {
                        read_wrapped_data_key(&pool, account_id)
                            .await?
                            .ok_or(WhatsAppStoreError::DeviceDeleted)?
                            .unwrap(kms, context)
                            .await?
                    }
                }
            }
        };

        Ok(Self {
            pool,
            account_id,
            lease_epoch,
            cipher: ValueCipher::new(account_id, &data_key),
            migrated_pn_sessions: Mutex::new(HashSet::new()),
        })
    }

    /// Deletes the account's device without opening it, so a device whose data
    /// key KMS no longer unwraps can still be replaced. Every key, session
    /// and value goes with it (they cascade); the next [`Self::open`]
    /// generates a new data key. Returns whether there was a device.
    ///
    /// # Errors
    /// [`WhatsAppStoreError::Fenced`] when the account's epoch is not
    /// `lease_epoch`, and database errors.
    #[tracing::instrument(
        name = "whatsapp_store.reset_device",
        skip(pool),
        fields(account_id = %account_id, lease_epoch, deleted),
        err
    )]
    pub async fn reset_device(
        pool: &PgPool,
        account_id: Uuid,
        lease_epoch: i64,
    ) -> Result<bool, WhatsAppStoreError> {
        let mut transaction = pool.begin().await?;
        check_lease(&mut transaction, account_id, lease_epoch).await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM whatsapp_device
            WHERE account_id = $1
            "#,
            account_id,
        )
        .execute(&mut *transaction)
        .await?
        .rows_affected()
            > 0;
        transaction.commit().await?;
        tracing::Span::current().record("deleted", deleted);
        Ok(deleted)
    }

    /// The account this store belongs to.
    pub fn account_id(&self) -> Uuid {
        self.account_id
    }

    /// The lease epoch every write is checked against.
    pub fn lease_epoch(&self) -> i64 {
        self.lease_epoch
    }

    /// Encrypts a blob the caller keeps elsewhere (e.g. a media download
    /// locator) under the account's data key, bound to the account and
    /// `purpose`: it only unseals with [`PgWhatsAppStore::unseal`] for the same
    /// account and purpose. The output is `SEALED_FORMAT | nonce | ciphertext`.
    ///
    /// # Errors
    /// [`WhatsAppStoreError::Encrypt`] if encryption fails.
    pub fn seal(&self, purpose: &str, plaintext: &[u8]) -> Result<Vec<u8>, WhatsAppStoreError> {
        let sealed = self
            .cipher
            .seal(StoreName::Sealed, &[purpose.as_bytes()], plaintext)?;
        Ok([&[SEALED_FORMAT], sealed.nonce.as_slice(), &sealed.value].concat())
    }

    /// Decrypts a blob from [`PgWhatsAppStore::seal`].
    ///
    /// # Errors
    /// [`WhatsAppStoreError::Decrypt`] if it was sealed for another account or
    /// purpose, was tampered with, or is not in a known format.
    pub fn unseal(
        &self,
        purpose: &str,
        sealed: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, WhatsAppStoreError> {
        let Some((&SEALED_FORMAT, rest)) = sealed.split_first() else {
            return Err(WhatsAppStoreError::Decrypt);
        };
        let (nonce, value) = rest
            .split_at_checked(SEALED_NONCE_LENGTH)
            .ok_or(WhatsAppStoreError::Decrypt)?;
        Ok(Zeroizing::new(self.cipher.open(
            StoreName::Sealed,
            &[purpose.as_bytes()],
            nonce,
            value,
        )?))
    }

    /// Begins a write transaction, failing with
    /// [`WhatsAppStoreError::Fenced`] unless this store still holds the lease.
    async fn begin_write(&self) -> Result<Transaction<'static, Postgres>, WhatsAppStoreError> {
        let mut transaction = self.pool.begin().await?;
        check_lease(&mut transaction, self.account_id, self.lease_epoch).await?;
        Ok(transaction)
    }

    /// Serializes read-modify-write operations of this account until the
    /// transaction ends. `NO KEY UPDATE`, so plain writes (whose foreign keys
    /// take `KEY SHARE` locks on the device row) are not blocked.
    async fn lock_device(&self, connection: &mut PgConnection) -> Result<(), WhatsAppStoreError> {
        sqlx::query_scalar!(
            r#"
            SELECT account_id
            FROM whatsapp_device
            WHERE account_id = $1
            FOR NO KEY UPDATE
            "#,
            self.account_id,
        )
        .fetch_optional(connection)
        .await?
        .ok_or(WhatsAppStoreError::DeviceDeleted)?;
        Ok(())
    }

    async fn get_value(
        &self,
        executor: impl PgExecutor<'_>,
        store: StoreName,
        key: &str,
    ) -> Result<Option<Vec<u8>>, WhatsAppStoreError> {
        let row = sqlx::query!(
            r#"
            SELECT nonce, value
            FROM whatsapp_store_value
            WHERE account_id = $1 AND store = $2 AND key = $3
            "#,
            self.account_id,
            store.as_str(),
            key,
        )
        .fetch_optional(executor)
        .await?;
        row.map(|row| {
            self.cipher
                .open(store, &[key.as_bytes()], &row.nonce, &row.value)
        })
        .transpose()
    }

    /// The values of the keys that have one.
    async fn get_values(
        &self,
        executor: impl PgExecutor<'_>,
        store: StoreName,
        keys: &[String],
    ) -> Result<HashMap<String, Vec<u8>>, WhatsAppStoreError> {
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = sqlx::query!(
            r#"
            SELECT key, nonce, value
            FROM whatsapp_store_value
            WHERE account_id = $1 AND store = $2 AND key = ANY($3)
            "#,
            self.account_id,
            store.as_str(),
            keys,
        )
        .fetch_all(executor)
        .await?;
        rows.into_iter()
            .map(|row| {
                let value =
                    self.cipher
                        .open(store, &[row.key.as_bytes()], &row.nonce, &row.value)?;
                Ok((row.key, value))
            })
            .collect()
    }

    /// Every value whose key starts with `prefix`, in key order.
    async fn list_values(
        &self,
        executor: impl PgExecutor<'_>,
        store: StoreName,
        prefix: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, WhatsAppStoreError> {
        let rows = sqlx::query!(
            r#"
            SELECT key, nonce, value
            FROM whatsapp_store_value
            WHERE account_id = $1 AND store = $2 AND key LIKE $3
            ORDER BY key
            "#,
            self.account_id,
            store.as_str(),
            like_prefix(prefix),
        )
        .fetch_all(executor)
        .await?;
        rows.into_iter()
            .map(|row| {
                let value =
                    self.cipher
                        .open(store, &[row.key.as_bytes()], &row.nonce, &row.value)?;
                Ok((row.key, value))
            })
            .collect()
    }

    /// Writes many values in one statement, replacing existing ones.
    async fn put_values(
        &self,
        connection: &mut PgConnection,
        store: StoreName,
        entries: BTreeMap<String, Vec<u8>>,
    ) -> Result<(), WhatsAppStoreError> {
        let (keys, nonces, values) = self.seal_values(store, entries)?;
        if keys.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_store_value (account_id, store, key, nonce, value)
            SELECT $1, $2, entry.key, entry.nonce, entry.value
            FROM UNNEST($3::text[], $4::bytea[], $5::bytea[]) AS entry(key, nonce, value)
            ON CONFLICT (account_id, store, key) DO UPDATE SET
                nonce = EXCLUDED.nonce,
                value = EXCLUDED.value,
                updated_at = now()
            "#,
            self.account_id,
            store.as_str(),
            &keys,
            &nonces,
            &values,
        )
        .execute(connection)
        .await?;
        Ok(())
    }

    /// Writes many values in one statement, keeping existing ones.
    async fn insert_values_if_absent(
        &self,
        connection: &mut PgConnection,
        store: StoreName,
        entries: BTreeMap<String, Vec<u8>>,
    ) -> Result<(), WhatsAppStoreError> {
        let (keys, nonces, values) = self.seal_values(store, entries)?;
        if keys.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_store_value (account_id, store, key, nonce, value)
            SELECT $1, $2, entry.key, entry.nonce, entry.value
            FROM UNNEST($3::text[], $4::bytea[], $5::bytea[]) AS entry(key, nonce, value)
            ON CONFLICT (account_id, store, key) DO NOTHING
            "#,
            self.account_id,
            store.as_str(),
            &keys,
            &nonces,
            &values,
        )
        .execute(connection)
        .await?;
        Ok(())
    }

    /// Seals entries into the three arrays of an `UNNEST` insert. A map, so a
    /// batch never names one key twice (which `ON CONFLICT` rejects), and in
    /// key order, so concurrent batches lock rows in the same order.
    #[expect(
        clippy::type_complexity,
        reason = "the three UNNEST columns, used right away by both callers"
    )]
    fn seal_values(
        &self,
        store: StoreName,
        entries: BTreeMap<String, Vec<u8>>,
    ) -> Result<(Vec<String>, Vec<Vec<u8>>, Vec<Vec<u8>>), WhatsAppStoreError> {
        let mut keys = Vec::with_capacity(entries.len());
        let mut nonces = Vec::with_capacity(entries.len());
        let mut values = Vec::with_capacity(entries.len());
        for (key, plaintext) in entries {
            let sealed = self.cipher.seal(store, &[key.as_bytes()], &plaintext)?;
            keys.push(key);
            nonces.push(sealed.nonce);
            values.push(sealed.value);
        }
        Ok((keys, nonces, values))
    }

    async fn delete_values(
        &self,
        connection: &mut PgConnection,
        store: StoreName,
        keys: &[String],
    ) -> Result<(), WhatsAppStoreError> {
        if keys.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_store_value
            WHERE account_id = $1 AND store = $2 AND key = ANY($3)
            "#,
            self.account_id,
            store.as_str(),
            keys,
        )
        .execute(connection)
        .await?;
        Ok(())
    }

    async fn delete_prefix(
        &self,
        connection: &mut PgConnection,
        store: StoreName,
        prefix: &str,
    ) -> Result<(), WhatsAppStoreError> {
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_store_value
            WHERE account_id = $1 AND store = $2 AND key LIKE $3
            "#,
            self.account_id,
            store.as_str(),
            like_prefix(prefix),
        )
        .execute(connection)
        .await?;
        Ok(())
    }

    /// Writes one value in its own fenced transaction.
    async fn put_one(
        &self,
        store: StoreName,
        key: String,
        plaintext: Vec<u8>,
    ) -> Result<(), WhatsAppStoreError> {
        let mut transaction = self.begin_write().await?;
        self.put_values(&mut transaction, store, BTreeMap::from([(key, plaintext)]))
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// Deletes one value in its own fenced transaction.
    async fn delete_one(&self, store: StoreName, key: String) -> Result<(), WhatsAppStoreError> {
        let mut transaction = self.begin_write().await?;
        self.delete_values(&mut transaction, store, &[key]).await?;
        transaction.commit().await?;
        Ok(())
    }
}

/// Fails with [`WhatsAppStoreError::Fenced`] unless the account still has
/// `lease_epoch`, and share-locks the account row until the transaction ends
/// so a takeover's epoch bump waits for this write.
async fn check_lease(
    connection: &mut PgConnection,
    account_id: Uuid,
    lease_epoch: i64,
) -> Result<(), WhatsAppStoreError> {
    let current = sqlx::query_scalar!(
        r#"
        SELECT lease_epoch
        FROM whatsapp_linked_account
        WHERE id = $1
        FOR SHARE
        "#,
        account_id,
    )
    .fetch_optional(connection)
    .await?;
    if current == Some(lease_epoch) {
        Ok(())
    } else {
        Err(WhatsAppStoreError::Fenced)
    }
}

/// The device row's wrapped data key.
struct WrappedDataKey {
    data_key_ciphertext: Vec<u8>,
    kms_key_id: String,
    encryption_version: i16,
}

impl WrappedDataKey {
    async fn unwrap(
        self,
        kms: &impl WhatsAppKms,
        context: HashMap<String, String>,
    ) -> Result<WhatsAppDataKey, WhatsAppStoreError> {
        // Checked before the KMS call: a version this build cannot read is our
        // bug to report, not a request worth a KMS call.
        if self.encryption_version != ENCRYPTION_VERSION {
            return Err(WhatsAppStoreError::UnsupportedVersion(
                self.encryption_version,
            ));
        }
        let plaintext = kms
            .decrypt(&self.kms_key_id, &self.data_key_ciphertext, context)
            .await?;
        WhatsAppDataKey::from_plaintext(&plaintext)
    }
}

async fn read_wrapped_data_key(
    pool: &PgPool,
    account_id: Uuid,
) -> Result<Option<WrappedDataKey>, WhatsAppStoreError> {
    Ok(sqlx::query_as!(
        WrappedDataKey,
        r#"
        SELECT data_key_ciphertext, kms_key_id, encryption_version
        FROM whatsapp_device
        WHERE account_id = $1
        "#,
        account_id,
    )
    .fetch_optional(pool)
    .await?)
}

/// A `LIKE` pattern matching keys that start with `prefix`. Signal users of
/// LIDs contain `_`, a `LIKE` wildcard, so the prefix is escaped.
fn like_prefix(prefix: &str) -> String {
    let mut pattern = String::with_capacity(prefix.len() + 1);
    for character in prefix.chars() {
        if matches!(character, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('%');
    pattern
}

/// Joins the parts of a composite key. The separator appears in no JID,
/// Signal address or message ID; a part containing it is rejected so two
/// different keys can never join to the same string.
fn composite_key(parts: &[&str]) -> Result<String, WhatsAppStoreError> {
    // The part itself stays out of the error: it may be a phone number.
    if parts.iter().any(|part| part.contains(KEY_SEPARATOR)) {
        return Err(WhatsAppStoreError::InvalidArgument(format!(
            "a store key part contains {KEY_SEPARATOR:?}"
        )));
    }
    Ok(parts.join(KEY_SEPARATOR))
}

const KEY_SEPARATOR: &str = "|";

/// The first byte of a [`PgWhatsAppStore::seal`] output, so another format can
/// be added later.
const SEALED_FORMAT: u8 = 1;
const SEALED_NONCE_LENGTH: usize = 12;
