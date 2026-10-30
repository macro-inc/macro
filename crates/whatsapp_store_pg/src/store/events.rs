//! Message secrets, privacy tokens, the NCT salt, and the buffers of incoming
//! and outgoing events.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use whatsmeow::store::{
    BufferedEvent, DecryptionTransaction, EventBuffer, MessageSecretInsert, MsgSecretStore,
    NctSaltStore, PrivacyToken, PrivacyTokenStore, StoreError,
};
use whatsmeow::types::{Jid, MessageId};

use super::{PgWhatsAppStore, composite_key};
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

/// The NCT salt is one value per account.
const NCT_SALT_KEY: &str = "";

/// WhatsApp servers buffer events for 14 days, so older hashes can't recur.
const BUFFERED_EVENT_RETENTION: TimeDelta = TimeDelta::days(14);

/// How long sent messages are kept for answering retry receipts.
const OUTGOING_EVENT_RETENTION: TimeDelta = TimeDelta::days(7);

fn message_secret_key(chat: &Jid, sender: &Jid, id: &str) -> Result<String, WhatsAppStoreError> {
    composite_key(&[&chat.to_string(), &sender.to_string(), id])
}

#[async_trait]
impl MsgSecretStore for PgWhatsAppStore {
    async fn put_message_secrets(&self, inserts: &[MessageSecretInsert]) -> Result<(), StoreError> {
        let mut secrets = BTreeMap::new();
        for insert in inserts {
            // Skipped as whatsmeow skips them.
            if insert.chat.is_empty()
                || insert.sender.is_empty()
                || insert.id.is_empty()
                || insert.secret.is_empty()
            {
                continue;
            }
            let key = message_secret_key(
                &insert.chat.to_non_ad(),
                &insert.sender.to_non_ad(),
                &insert.id,
            )?;
            // The first secret of a message wins, as with `ON CONFLICT DO NOTHING`.
            secrets.entry(key).or_insert_with(|| insert.secret.clone());
        }
        if secrets.is_empty() {
            return Ok(());
        }
        let mut transaction = self.begin_write().await?;
        self.insert_values_if_absent(&mut transaction, StoreName::MessageSecret, secrets)
            .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    async fn put_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
        secret: Vec<u8>,
    ) -> Result<(), StoreError> {
        let key = message_secret_key(&chat.to_non_ad(), &sender.to_non_ad(), id)?;
        let mut transaction = self.begin_write().await?;
        self.insert_values_if_absent(
            &mut transaction,
            StoreName::MessageSecret,
            BTreeMap::from([(key, secret)]),
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(())
    }

    /// Like whatsmeow, also finds a secret stored under the other identity
    /// (LID or phone number) of the chat or the sender.
    async fn get_message_secret(
        &self,
        chat: &Jid,
        sender: &Jid,
        id: &MessageId,
    ) -> Result<Option<(Vec<u8>, Jid)>, StoreError> {
        let chat = chat.to_non_ad();
        let sender = sender.to_non_ad();
        let chats = self.with_alternate(chat).await?;
        let senders = self.with_alternate(sender).await?;
        let mut candidates = Vec::with_capacity(chats.len() * senders.len());
        for chat in &chats {
            for sender in &senders {
                candidates.push((message_secret_key(chat, sender, id)?, sender.clone()));
            }
        }
        let keys: Vec<String> = candidates.iter().map(|(key, _)| key.clone()).collect();
        let mut found = self
            .get_values(&self.pool, StoreName::MessageSecret, &keys)
            .await?;
        Ok(candidates
            .into_iter()
            .find_map(|(key, sender)| Some((found.remove(&key)?, sender))))
    }
}

/// A privacy token as sealed in its value; the timestamp is the row's
/// plaintext `token_timestamp`, which expiry deletes by.
#[derive(Serialize, Deserialize)]
struct PrivacyTokenRecord {
    token: Vec<u8>,
    sender_timestamp: Option<DateTime<Utc>>,
}

impl PgWhatsAppStore {
    fn open_privacy_token(
        &self,
        user_jid: &str,
        nonce: &[u8],
        value: &[u8],
    ) -> Result<PrivacyTokenRecord, WhatsAppStoreError> {
        let plaintext = self.cipher.open(
            StoreName::PrivacyToken,
            &[user_jid.as_bytes()],
            nonce,
            value,
        )?;
        postcard::from_bytes(&plaintext).map_err(|_| WhatsAppStoreError::Malformed)
    }
}

#[async_trait]
impl PrivacyTokenStore for PgWhatsAppStore {
    /// As whatsmeow: an older token never replaces a newer one, and a token
    /// without a sender timestamp keeps the stored one.
    async fn put_privacy_tokens(&self, tokens: &[PrivacyToken]) -> Result<(), StoreError> {
        let mut newest: BTreeMap<String, &PrivacyToken> = BTreeMap::new();
        for token in tokens {
            let user = token.user.to_non_ad().to_string();
            match newest.get(&user) {
                Some(kept) if kept.timestamp > token.timestamp => {}
                _ => {
                    newest.insert(user, token);
                }
            }
        }
        if newest.is_empty() {
            return Ok(());
        }
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        let users: Vec<String> = newest.keys().cloned().collect();
        let existing = sqlx::query!(
            r#"
            SELECT user_jid, token_timestamp, nonce, value
            FROM whatsapp_privacy_token
            WHERE account_id = $1 AND user_jid = ANY($2)
            "#,
            self.account_id,
            &users,
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(WhatsAppStoreError::from)?;
        let existing: HashMap<String, (DateTime<Utc>, Option<DateTime<Utc>>)> = existing
            .into_iter()
            .map(|row| {
                let record = self.open_privacy_token(&row.user_jid, &row.nonce, &row.value)?;
                Ok((row.user_jid, (row.token_timestamp, record.sender_timestamp)))
            })
            .collect::<Result<_, WhatsAppStoreError>>()?;

        let mut user_jids = Vec::with_capacity(newest.len());
        let mut timestamps = Vec::with_capacity(newest.len());
        let mut nonces = Vec::with_capacity(newest.len());
        let mut values = Vec::with_capacity(newest.len());
        for (user, token) in newest {
            let sender_timestamp = match existing.get(&user) {
                Some((stored, _)) if token.timestamp < *stored => continue,
                Some((_, stored_sender)) => token.sender_timestamp.or(*stored_sender),
                None => token.sender_timestamp,
            };
            let plaintext = postcard::to_allocvec(&PrivacyTokenRecord {
                token: token.token.clone(),
                sender_timestamp,
            })
            .map_err(|_| WhatsAppStoreError::Malformed)?;
            let sealed =
                self.cipher
                    .seal(StoreName::PrivacyToken, &[user.as_bytes()], &plaintext)?;
            user_jids.push(user);
            timestamps.push(token.timestamp);
            nonces.push(sealed.nonce);
            values.push(sealed.value);
        }
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_privacy_token (account_id, user_jid, token_timestamp, nonce, value)
            SELECT $1, entry.user_jid, entry.token_timestamp, entry.nonce, entry.value
            FROM UNNEST($2::text[], $3::timestamptz[], $4::bytea[], $5::bytea[])
                AS entry(user_jid, token_timestamp, nonce, value)
            ON CONFLICT (account_id, user_jid) DO UPDATE SET
                token_timestamp = EXCLUDED.token_timestamp,
                nonce = EXCLUDED.nonce,
                value = EXCLUDED.value
            "#,
            self.account_id,
            &user_jids,
            &timestamps,
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

    /// Like whatsmeow, also finds a token stored under the user's other
    /// identity (LID or phone number), preferring the newest.
    async fn get_privacy_token(&self, user: &Jid) -> Result<Option<PrivacyToken>, StoreError> {
        let user = user.to_non_ad();
        let candidates: Vec<String> = self
            .with_alternate(user.clone())
            .await?
            .iter()
            .map(Jid::to_string)
            .collect();
        let row = sqlx::query!(
            r#"
            SELECT user_jid, token_timestamp, nonce, value
            FROM whatsapp_privacy_token
            WHERE account_id = $1 AND user_jid = ANY($2)
            ORDER BY token_timestamp DESC
            LIMIT 1
            "#,
            self.account_id,
            &candidates,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let record = self.open_privacy_token(&row.user_jid, &row.nonce, &row.value)?;
        Ok(Some(PrivacyToken {
            user,
            token: record.token,
            timestamp: row.token_timestamp,
            sender_timestamp: record.sender_timestamp,
        }))
    }

    async fn delete_expired_privacy_tokens(
        &self,
        cutoff: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        let mut transaction = self.begin_write().await?;
        let deleted = sqlx::query!(
            r#"
            DELETE FROM whatsapp_privacy_token
            WHERE account_id = $1 AND token_timestamp < $2
            "#,
            self.account_id,
            cutoff,
        )
        .execute(&mut *transaction)
        .await
        .map_err(WhatsAppStoreError::from)?
        .rows_affected();
        transaction
            .commit()
            .await
            .map_err(WhatsAppStoreError::from)?;
        Ok(deleted)
    }
}

#[async_trait]
impl NctSaltStore for PgWhatsAppStore {
    async fn put_nct_salt(&self, salt: Vec<u8>) -> Result<(), StoreError> {
        Ok(self
            .put_one(StoreName::NctSalt, NCT_SALT_KEY.to_owned(), salt)
            .await?)
    }

    async fn get_nct_salt(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::NctSalt, NCT_SALT_KEY)
            .await?)
    }

    async fn delete_nct_salt(&self) -> Result<(), StoreError> {
        Ok(self
            .delete_one(StoreName::NctSalt, NCT_SALT_KEY.to_owned())
            .await?)
    }
}

/// A sent event as sealed in its value.
#[derive(Serialize, Deserialize)]
struct OutgoingEventRecord {
    format: String,
    plaintext: Vec<u8>,
}

#[async_trait]
impl EventBuffer for PgWhatsAppStore {
    async fn get_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<Option<BufferedEvent>, StoreError> {
        let row = sqlx::query!(
            r#"
            SELECT server_time, inserted_at, nonce, value
            FROM whatsapp_event_buffer
            WHERE account_id = $1 AND ciphertext_hash = $2
            "#,
            self.account_id,
            ciphertext_hash.as_slice(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let plaintext = match (row.nonce, row.value) {
            (Some(nonce), Some(value)) => self.cipher.open(
                StoreName::BufferedEvent,
                &[&ciphertext_hash],
                &nonce,
                &value,
            )?,
            // Cleared once handled.
            _ => Vec::new(),
        };
        Ok(Some(BufferedEvent {
            plaintext,
            insert_time: row.inserted_at,
            server_time: row.server_time,
        }))
    }

    async fn put_buffered_event(
        &self,
        ciphertext_hash: [u8; 32],
        plaintext: Vec<u8>,
        server_timestamp: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let sealed = self
            .cipher
            .seal(StoreName::BufferedEvent, &[&ciphertext_hash], &plaintext)?;
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_event_buffer (account_id, ciphertext_hash, server_time, nonce, value)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, ciphertext_hash) DO UPDATE SET
                server_time = EXCLUDED.server_time,
                inserted_at = now(),
                nonce = EXCLUDED.nonce,
                value = EXCLUDED.value
            "#,
            self.account_id,
            ciphertext_hash.as_slice(),
            server_timestamp,
            sealed.nonce,
            sealed.value,
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

    /// whatsmeow runs the body in a database transaction that its store
    /// calls join through the context; the port has no context to carry one,
    /// so the body's calls run in their own transactions.
    async fn do_decryption_txn(&self, body: DecryptionTransaction<'_>) -> Result<(), StoreError> {
        body.await
    }

    async fn clear_buffered_event_plaintext(
        &self,
        ciphertext_hash: [u8; 32],
    ) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            UPDATE whatsapp_event_buffer
            SET nonce = NULL, value = NULL
            WHERE account_id = $1 AND ciphertext_hash = $2
            "#,
            self.account_id,
            ciphertext_hash.as_slice(),
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

    async fn delete_old_buffered_hashes(&self) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_event_buffer
            WHERE account_id = $1 AND inserted_at < $2
            "#,
            self.account_id,
            Utc::now() - BUFFERED_EVENT_RETENTION,
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

    async fn get_outgoing_event(
        &self,
        chat_jid: &Jid,
        alt_chat_jid: &Jid,
        id: &MessageId,
    ) -> Result<Option<(String, Vec<u8>)>, StoreError> {
        let chat_jid = chat_jid.to_string();
        let candidates = [chat_jid.clone(), alt_chat_jid.to_string()];
        let rows = sqlx::query!(
            r#"
            SELECT chat_jid, nonce, value
            FROM whatsapp_outgoing_event
            WHERE account_id = $1 AND chat_jid = ANY($2) AND message_id = $3
            "#,
            self.account_id,
            &candidates,
            id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(WhatsAppStoreError::from)?;
        // Prefer the event stored under the chat JID itself.
        let Some(row) = rows
            .iter()
            .find(|row| row.chat_jid == chat_jid)
            .or_else(|| rows.first())
        else {
            return Ok(None);
        };
        let plaintext = self.cipher.open(
            StoreName::OutgoingEvent,
            &[row.chat_jid.as_bytes(), id.as_bytes()],
            &row.nonce,
            &row.value,
        )?;
        let record: OutgoingEventRecord =
            postcard::from_bytes(&plaintext).map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(Some((record.format, record.plaintext)))
    }

    async fn add_outgoing_event(
        &self,
        chat_jid: &Jid,
        id: &MessageId,
        format: &str,
        plaintext: Vec<u8>,
    ) -> Result<(), StoreError> {
        let chat_jid = chat_jid.to_string();
        let record = postcard::to_allocvec(&OutgoingEventRecord {
            format: format.to_owned(),
            plaintext,
        })
        .map_err(|_| WhatsAppStoreError::Malformed)?;
        let sealed = self.cipher.seal(
            StoreName::OutgoingEvent,
            &[chat_jid.as_bytes(), id.as_bytes()],
            &record,
        )?;
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            INSERT INTO whatsapp_outgoing_event (account_id, chat_jid, message_id, nonce, value)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, chat_jid, message_id) DO UPDATE SET
                created_at = now(),
                nonce = EXCLUDED.nonce,
                value = EXCLUDED.value
            "#,
            self.account_id,
            chat_jid,
            id,
            sealed.nonce,
            sealed.value,
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

    async fn delete_old_outgoing_events(&self) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_outgoing_event
            WHERE account_id = $1 AND created_at < $2
            "#,
            self.account_id,
            Utc::now() - OUTGOING_EVENT_RETENTION,
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
}
