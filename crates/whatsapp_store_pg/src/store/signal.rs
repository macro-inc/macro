//! Identities, sessions, prekeys and sender keys: what libsignal reads and
//! writes, following whatsmeow's `store/sqlstore`.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use whatsmeow::store::{IdentityStore, PreKeyStore, SenderKeyStore, SessionStore, StoreError};
use whatsmeow::types::Jid;
use whatsmeow::util::keys::{PreKey, new_key_pair_from_private_key, new_pre_key};

use super::{PgWhatsAppStore, composite_key};
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

/// The prefix of every Signal address of a user: `user:device`.
fn address_prefix(user: &str) -> String {
    format!("{user}:")
}

#[async_trait]
impl IdentityStore for PgWhatsAppStore {
    async fn put_identity(&self, address: &str, key: [u8; 32]) -> Result<(), StoreError> {
        Ok(self
            .put_one(StoreName::Identity, address.to_owned(), key.to_vec())
            .await?)
    }

    async fn delete_all_identities(&self, phone: &str) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        self.delete_prefix(
            &mut transaction,
            StoreName::Identity,
            &address_prefix(phone),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn delete_identity(&self, address: &str) -> Result<(), StoreError> {
        Ok(self
            .delete_one(StoreName::Identity, address.to_owned())
            .await?)
    }

    async fn is_trusted_identity(&self, address: &str, key: [u8; 32]) -> Result<bool, StoreError> {
        let Some(existing) = self
            .get_value(&self.pool, StoreName::Identity, address)
            .await?
        else {
            // Trust if not known; it is saved automatically later.
            return Ok(true);
        };
        let existing: [u8; 32] = existing
            .try_into()
            .map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(existing == key)
    }
}

#[async_trait]
impl SessionStore for PgWhatsAppStore {
    async fn get_session(&self, address: &str) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::Session, address)
            .await?)
    }

    async fn has_session(&self, address: &str) -> Result<bool, StoreError> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM whatsapp_store_value
                WHERE account_id = $1 AND store = $2 AND key = $3
            ) AS "exists!"
            "#,
            self.account_id,
            StoreName::Session.as_str(),
            address,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        Ok(exists)
    }

    async fn get_many_sessions(
        &self,
        addresses: &[String],
    ) -> Result<HashMap<String, Option<Vec<u8>>>, StoreError> {
        let mut found = self
            .get_values(&self.pool, StoreName::Session, addresses)
            .await?;
        Ok(addresses
            .iter()
            .map(|address| (address.clone(), found.remove(address)))
            .collect())
    }

    async fn put_session(&self, address: &str, session: Vec<u8>) -> Result<(), StoreError> {
        Ok(self
            .put_one(StoreName::Session, address.to_owned(), session)
            .await?)
    }

    async fn put_many_sessions(
        &self,
        sessions: HashMap<String, Vec<u8>>,
    ) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        self.put_values(
            &mut transaction,
            StoreName::Session,
            sessions.into_iter().collect(),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn delete_all_sessions(&self, phone: &str) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        self.delete_prefix(&mut transaction, StoreName::Session, &address_prefix(phone))
            .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn delete_session(&self, address: &str) -> Result<(), StoreError> {
        Ok(self
            .delete_one(StoreName::Session, address.to_owned())
            .await?)
    }

    #[tracing::instrument(
        name = "whatsapp_store.migrate_pn_to_lid",
        skip_all,
        fields(account_id = %self.account_id),
        err
    )]
    async fn migrate_pn_to_lid(&self, pn: &Jid, lid: &Jid) -> Result<(), StoreError> {
        let pn_user = pn.signal_address_user();
        if !self.migrated_users().insert(pn_user.clone()) {
            return Ok(());
        }
        let migrated = self
            .move_signal_user(
                &address_prefix(&pn_user),
                &address_prefix(&lid.signal_address_user()),
            )
            .await;
        if migrated.is_err() {
            // Not migrated after all: let the next call try again.
            self.migrated_users().remove(&pn_user);
        }
        Ok(migrated?)
    }
}

impl PgWhatsAppStore {
    fn migrated_users(&self) -> std::sync::MutexGuard<'_, std::collections::HashSet<String>> {
        // Every use is one set operation, so a panic can't leave it half-written.
        self.migrated_pn_sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Moves the sessions, identities and sender keys of one Signal user to
    /// another, re-encrypting each under its new key, replacing what the new
    /// user already has. Sender keys are keyed sender first, so the same
    /// prefix finds them.
    async fn move_signal_user(&self, from: &str, to: &str) -> Result<(), WhatsAppStoreError> {
        let mut transaction = self.begin_write().await?;
        for store in [
            StoreName::Session,
            StoreName::Identity,
            StoreName::SenderKey,
        ] {
            let moved: BTreeMap<String, Vec<u8>> = self
                .list_values(&mut *transaction, store, from)
                .await?
                .into_iter()
                .filter_map(|(key, value)| {
                    let rest = key.strip_prefix(from)?;
                    Some((format!("{to}{rest}"), value))
                })
                .collect();
            if moved.is_empty() {
                continue;
            }
            tracing::debug!(
                store = store.as_str(),
                count = moved.len(),
                "moving signal user"
            );
            self.put_values(&mut transaction, store, moved).await?;
            self.delete_prefix(&mut transaction, store, from).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// The next prekey ID: one past the highest ever stored, as whatsmeow
    /// numbers them (from 1).
    async fn next_pre_key_id(
        &self,
        connection: &mut sqlx::PgConnection,
    ) -> Result<u32, WhatsAppStoreError> {
        let last = sqlx::query_scalar!(
            r#"
            SELECT MAX(key_id)
            FROM whatsapp_pre_key
            WHERE account_id = $1
            "#,
            self.account_id,
        )
        .fetch_one(connection)
        .await?
        .unwrap_or(0);
        u32::try_from(last + 1)
            .map_err(|_| WhatsAppStoreError::InvalidArgument("prekey IDs exhausted".to_owned()))
    }

    /// Stores new prekeys in one statement.
    async fn insert_pre_keys(
        &self,
        connection: &mut sqlx::PgConnection,
        keys: &[PreKey],
        uploaded: bool,
    ) -> Result<(), WhatsAppStoreError> {
        let mut key_ids = Vec::with_capacity(keys.len());
        let mut nonces = Vec::with_capacity(keys.len());
        let mut values = Vec::with_capacity(keys.len());
        for key in keys {
            let sealed = self.cipher.seal(
                StoreName::PreKey,
                &[&key.key_id.to_be_bytes()],
                &key.key_pair.private,
            )?;
            key_ids.push(i64::from(key.key_id));
            nonces.push(sealed.nonce);
            values.push(sealed.value);
        }
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_pre_key (account_id, key_id, uploaded, nonce, value)
            SELECT $1, entry.key_id, $2, entry.nonce, entry.value
            FROM UNNEST($3::bigint[], $4::bytea[], $5::bytea[]) AS entry(key_id, nonce, value)
            "#,
            self.account_id,
            uploaded,
            &key_ids,
            &nonces,
            &values,
        )
        .execute(connection)
        .await?;
        Ok(())
    }

    fn open_pre_key(
        &self,
        key_id: i64,
        nonce: &[u8],
        value: &[u8],
    ) -> Result<PreKey, WhatsAppStoreError> {
        let key_id = u32::try_from(key_id).map_err(|_| WhatsAppStoreError::Malformed)?;
        let private: [u8; 32] = self
            .cipher
            .open(StoreName::PreKey, &[&key_id.to_be_bytes()], nonce, value)?
            .try_into()
            .map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(PreKey {
            key_pair: new_key_pair_from_private_key(private),
            key_id,
            signature: None,
        })
    }
}

#[async_trait]
impl PreKeyStore for PgWhatsAppStore {
    #[tracing::instrument(
        name = "whatsapp_store.get_or_gen_pre_keys",
        skip(self),
        fields(account_id = %self.account_id, generated),
        err
    )]
    async fn get_or_gen_pre_keys(&self, count: u32) -> Result<Vec<PreKey>, StoreError> {
        let mut transaction = self.begin_write().await?;
        // Serializes prekey numbering, as whatsmeow's prekey lock does.
        self.lock_device(&mut transaction).await?;
        let rows = sqlx::query!(
            r#"
            SELECT key_id, nonce, value
            FROM whatsapp_pre_key
            WHERE account_id = $1 AND NOT uploaded
            ORDER BY key_id
            LIMIT $2
            "#,
            self.account_id,
            i64::from(count),
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(WhatsAppStoreError::from)?;
        let mut keys = rows
            .iter()
            .map(|row| self.open_pre_key(row.key_id, &row.nonce, &row.value))
            .collect::<Result<Vec<_>, _>>()?;
        let missing = count.saturating_sub(u32::try_from(keys.len()).unwrap_or(u32::MAX));
        tracing::Span::current().record("generated", missing);
        if missing > 0 {
            let first_id = self.next_pre_key_id(&mut transaction).await?;
            let new_keys = (0..missing)
                .map(|offset| {
                    first_id
                        .checked_add(offset)
                        .map(new_pre_key)
                        .ok_or_else(|| {
                            WhatsAppStoreError::InvalidArgument("prekey IDs exhausted".to_owned())
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            self.insert_pre_keys(&mut transaction, &new_keys, false)
                .await?;
            keys.extend(new_keys);
        }
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(keys)
    }

    async fn gen_one_pre_key(&self) -> Result<PreKey, StoreError> {
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        let key = new_pre_key(self.next_pre_key_id(&mut transaction).await?);
        self.insert_pre_keys(&mut transaction, std::slice::from_ref(&key), true)
            .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(key)
    }

    async fn get_pre_key(&self, id: u32) -> Result<Option<PreKey>, StoreError> {
        let row = sqlx::query!(
            r#"
            SELECT key_id, nonce, value
            FROM whatsapp_pre_key
            WHERE account_id = $1 AND key_id = $2
            "#,
            self.account_id,
            i64::from(id),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        Ok(row
            .map(|row| self.open_pre_key(row.key_id, &row.nonce, &row.value))
            .transpose()?)
    }

    async fn remove_pre_key(&self, id: u32) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_pre_key
            WHERE account_id = $1 AND key_id = $2
            "#,
            self.account_id,
            i64::from(id),
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

    async fn mark_pre_keys_as_uploaded(&self, up_to_id: u32) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            UPDATE whatsapp_pre_key
            SET uploaded = true
            WHERE account_id = $1 AND key_id <= $2 AND NOT uploaded
            "#,
            self.account_id,
            i64::from(up_to_id),
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

    async fn uploaded_pre_key_count(&self) -> Result<usize, StoreError> {
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) AS "count!"
            FROM whatsapp_pre_key
            WHERE account_id = $1 AND uploaded
            "#,
            self.account_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        Ok(usize::try_from(count).map_err(|_| WhatsAppStoreError::Malformed)?)
    }
}

#[async_trait]
impl SenderKeyStore for PgWhatsAppStore {
    async fn put_sender_key(
        &self,
        group: &str,
        user: &str,
        session: Vec<u8>,
    ) -> Result<(), StoreError> {
        // Sender first, so a user's sender keys share a key prefix.
        let key = composite_key(&[user, group])?;
        Ok(self.put_one(StoreName::SenderKey, key, session).await?)
    }

    async fn get_sender_key(&self, group: &str, user: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let key = composite_key(&[user, group])?;
        Ok(self
            .get_value(&self.pool, StoreName::SenderKey, &key)
            .await?)
    }
}
