//! App state sync keys, collection versions and mutation MACs.

#[cfg(test)]
mod test;

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use whatsmeow::store::{
    AppStateMutationMac, AppStateStore, AppStateSyncKey, AppStateSyncKeyStore, StoreError,
};

use super::PgWhatsAppStore;
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

const HASH_LENGTH: usize = 128;

/// An app state sync key as sealed in its value.
#[derive(Serialize, Deserialize)]
struct SyncKeyRecord {
    data: Vec<u8>,
    fingerprint: Vec<u8>,
    timestamp: i64,
}

impl From<SyncKeyRecord> for AppStateSyncKey {
    fn from(record: SyncKeyRecord) -> Self {
        AppStateSyncKey {
            data: record.data,
            fingerprint: record.fingerprint,
            timestamp: record.timestamp,
        }
    }
}

fn decode_sync_key(plaintext: &[u8]) -> Result<SyncKeyRecord, WhatsAppStoreError> {
    postcard::from_bytes(plaintext).map_err(|_| WhatsAppStoreError::Malformed)
}

impl PgWhatsAppStore {
    /// Every sync key with its ID, newest first.
    async fn all_sync_keys(&self) -> Result<Vec<(Vec<u8>, SyncKeyRecord)>, WhatsAppStoreError> {
        let mut keys = self
            .list_values(&self.pool, StoreName::AppStateSyncKey, "")
            .await?
            .into_iter()
            .map(|(id, plaintext)| {
                let id = hex::decode(id).map_err(|_| WhatsAppStoreError::Malformed)?;
                Ok((id, decode_sync_key(&plaintext)?))
            })
            .collect::<Result<Vec<_>, WhatsAppStoreError>>()?;
        keys.sort_by_key(|(_, key)| std::cmp::Reverse(key.timestamp));
        Ok(keys)
    }
}

/// An account has a handful of sync keys, so "newest" is computed over all
/// of them after decrypting rather than from a plaintext timestamp column.
#[async_trait]
impl AppStateSyncKeyStore for PgWhatsAppStore {
    async fn put_app_state_sync_key(
        &self,
        id: &[u8],
        key: AppStateSyncKey,
    ) -> Result<(), StoreError> {
        let id = hex::encode(id);
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        let existing = self
            .get_value(&mut *transaction, StoreName::AppStateSyncKey, &id)
            .await?
            .map(|plaintext| decode_sync_key(&plaintext))
            .transpose()?;
        // As whatsmeow: a key is only replaced by a newer one.
        if existing.is_some_and(|existing| key.timestamp <= existing.timestamp) {
            return Ok(());
        }
        let record = SyncKeyRecord {
            data: key.data,
            fingerprint: key.fingerprint,
            timestamp: key.timestamp,
        };
        let plaintext =
            postcard::to_allocvec(&record).map_err(|_| WhatsAppStoreError::Malformed)?;
        self.put_values(
            &mut transaction,
            StoreName::AppStateSyncKey,
            BTreeMap::from([(id, plaintext)]),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn get_app_state_sync_key(
        &self,
        id: &[u8],
    ) -> Result<Option<AppStateSyncKey>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::AppStateSyncKey, &hex::encode(id))
            .await?
            .map(|plaintext| decode_sync_key(&plaintext).map(AppStateSyncKey::from))
            .transpose()?)
    }

    async fn get_latest_app_state_sync_key_id(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .all_sync_keys()
            .await?
            .into_iter()
            .next()
            .map(|(id, _)| id))
    }

    async fn get_all_app_state_sync_keys(&self) -> Result<Vec<AppStateSyncKey>, StoreError> {
        Ok(self
            .all_sync_keys()
            .await?
            .into_iter()
            .map(|(_, key)| key.into())
            .collect())
    }
}

/// The version and LT hash of a collection, sealed as the version (8 bytes,
/// big endian) followed by the 128-byte hash.
fn encode_version(version: u64, hash: &[u8; HASH_LENGTH]) -> Vec<u8> {
    [version.to_be_bytes().as_slice(), hash].concat()
}

fn decode_version(plaintext: &[u8]) -> Result<(u64, [u8; HASH_LENGTH]), WhatsAppStoreError> {
    let (version, hash) = plaintext
        .split_first_chunk::<8>()
        .ok_or(WhatsAppStoreError::Malformed)?;
    let hash: [u8; HASH_LENGTH] = hash.try_into().map_err(|_| WhatsAppStoreError::Malformed)?;
    Ok((u64::from_be_bytes(*version), hash))
}

#[async_trait]
impl AppStateStore for PgWhatsAppStore {
    async fn put_app_state_version(
        &self,
        name: &str,
        version: u64,
        hash: [u8; 128],
    ) -> Result<(), StoreError> {
        Ok(self
            .put_one(
                StoreName::AppStateVersion,
                name.to_owned(),
                encode_version(version, &hash),
            )
            .await?)
    }

    async fn get_app_state_version(&self, name: &str) -> Result<(u64, [u8; 128]), StoreError> {
        let Some(plaintext) = self
            .get_value(&self.pool, StoreName::AppStateVersion, name)
            .await?
        else {
            // Version 0 and an empty hash: the initial state.
            return Ok((0, [0; HASH_LENGTH]));
        };
        Ok(decode_version(&plaintext)?)
    }

    async fn delete_app_state_version(&self, name: &str) -> Result<(), StoreError> {
        Ok(self
            .delete_one(StoreName::AppStateVersion, name.to_owned())
            .await?)
    }

    async fn put_app_state_mutation_macs(
        &self,
        name: &str,
        version: u64,
        mutations: &[AppStateMutationMac],
    ) -> Result<(), StoreError> {
        if mutations.is_empty() {
            return Ok(());
        }
        let stored_version = i64::try_from(version).map_err(|_| {
            WhatsAppStoreError::InvalidArgument("app state version out of range".to_owned())
        })?;
        // One row per index MAC: a batch naming one twice keeps the last, as
        // the later mutation wins.
        let by_index: BTreeMap<&[u8], &[u8]> = mutations
            .iter()
            .map(|mutation| (mutation.index_mac.as_slice(), mutation.value_mac.as_slice()))
            .collect();
        let mut index_macs = Vec::with_capacity(by_index.len());
        let mut nonces = Vec::with_capacity(by_index.len());
        let mut values = Vec::with_capacity(by_index.len());
        for (index_mac, value_mac) in by_index {
            let sealed = self.cipher.seal(
                StoreName::AppStateMutationMac,
                &[name.as_bytes(), index_mac, &version.to_be_bytes()],
                value_mac,
            )?;
            index_macs.push(index_mac.to_vec());
            nonces.push(sealed.nonce);
            values.push(sealed.value);
        }
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_app_state_mutation_mac (
                account_id, name, index_mac, version, nonce, value
            )
            SELECT $1, $2, entry.index_mac, $3, entry.nonce, entry.value
            FROM UNNEST($4::bytea[], $5::bytea[], $6::bytea[]) AS entry(index_mac, nonce, value)
            ON CONFLICT (account_id, name, index_mac, version) DO UPDATE SET
                nonce = EXCLUDED.nonce,
                value = EXCLUDED.value
            "#,
            self.account_id,
            name,
            stored_version,
            &index_macs,
            &nonces,
            &values,
        )
        .execute(&mut *transaction)
        .await
        .map_err(WhatsAppStoreError::from)?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn delete_app_state_mutation_macs(
        &self,
        name: &str,
        index_macs: &[Vec<u8>],
    ) -> Result<(), StoreError> {
        if index_macs.is_empty() {
            return Ok(());
        }
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_app_state_mutation_mac
            WHERE account_id = $1 AND name = $2 AND index_mac = ANY($3)
            "#,
            self.account_id,
            name,
            index_macs,
        )
        .execute(&mut *transaction)
        .await
        .map_err(WhatsAppStoreError::from)?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn get_app_state_mutation_mac(
        &self,
        name: &str,
        index_mac: &[u8],
    ) -> Result<Option<Vec<u8>>, StoreError> {
        let row = sqlx::query!(
            r#"
            SELECT version, nonce, value
            FROM whatsapp_app_state_mutation_mac
            WHERE account_id = $1 AND name = $2 AND index_mac = $3
            ORDER BY version DESC
            LIMIT 1
            "#,
            self.account_id,
            name,
            index_mac,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let version = u64::try_from(row.version).map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(Some(self.cipher.open(
            StoreName::AppStateMutationMac,
            &[name.as_bytes(), index_mac, &version.to_be_bytes()],
            &row.nonce,
            &row.value,
        )?))
    }
}
