//! Contact names and local chat settings. Each contact or chat is one sealed
//! record, so whatsmeow's per-column updates become read-modify-writes under
//! the device lock.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use whatsmeow::store::{
    ChatSettingsStore, ContactEntry, ContactStore, RedactedPhoneEntry, StoreError,
};
use whatsmeow::types::{ContactInfo, Jid, LocalChatSettings, MessageId};

use super::PgWhatsAppStore;
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

/// A contact as sealed in its value.
#[derive(Default, Serialize, Deserialize)]
struct ContactRecord {
    first_name: String,
    full_name: String,
    push_name: String,
    business_name: String,
    redacted_phone: String,
}

impl From<ContactRecord> for ContactInfo {
    fn from(record: ContactRecord) -> Self {
        ContactInfo {
            first_name: record.first_name,
            full_name: record.full_name,
            push_name: record.push_name,
            business_name: record.business_name,
            redacted_phone: record.redacted_phone,
        }
    }
}

/// A chat's settings as sealed in its value.
#[derive(Default, Serialize, Deserialize)]
struct ChatSettingsRecord {
    muted_until: Option<DateTime<Utc>>,
    pinned: bool,
    archived: bool,
    wasa_root_secret_id: Option<MessageId>,
}

fn encode<Record: Serialize>(record: &Record) -> Result<Vec<u8>, WhatsAppStoreError> {
    postcard::to_allocvec(record).map_err(|_| WhatsAppStoreError::Malformed)
}

fn decode<Record: for<'de> Deserialize<'de>>(
    plaintext: &[u8],
) -> Result<Record, WhatsAppStoreError> {
    postcard::from_bytes(plaintext).map_err(|_| WhatsAppStoreError::Malformed)
}

impl PgWhatsAppStore {
    /// Updates the records of `keys` in one transaction: reads them under the
    /// device lock (a missing one starts from its default), applies `update`
    /// to each, and writes back those it reports changed. Returns what
    /// `update` returned per key.
    async fn update_records<Record, Outcome>(
        &self,
        store: StoreName,
        keys: Vec<String>,
        mut update: impl FnMut(&str, &mut Record) -> (bool, Outcome) + Send,
    ) -> Result<HashMap<String, Outcome>, WhatsAppStoreError>
    where
        Record: Default + Serialize + for<'de> Deserialize<'de>,
    {
        let mut transaction = self.begin_write().await?;
        self.lock_device(&mut transaction).await?;
        let mut existing = self.get_values(&mut *transaction, store, &keys).await?;
        let mut changed = BTreeMap::new();
        let mut outcomes = HashMap::with_capacity(keys.len());
        for key in keys {
            let mut record = existing
                .remove(&key)
                .map(|plaintext| decode::<Record>(&plaintext))
                .transpose()?
                .unwrap_or_default();
            let (was_changed, outcome) = update(&key, &mut record);
            if was_changed {
                changed.insert(key.clone(), encode(&record)?);
            }
            outcomes.insert(key, outcome);
        }
        self.put_values(&mut transaction, store, changed).await?;
        transaction.commit().await?;
        Ok(outcomes)
    }

    async fn update_record<Record, Outcome>(
        &self,
        store: StoreName,
        key: String,
        mut update: impl FnMut(&mut Record) -> (bool, Outcome) + Send,
    ) -> Result<Outcome, WhatsAppStoreError>
    where
        Record: Default + Serialize + for<'de> Deserialize<'de>,
    {
        self.update_records(store, vec![key], |_, record| update(record))
            .await?
            .into_values()
            .next()
            .ok_or(WhatsAppStoreError::Malformed)
    }
}

/// Replaces a name, reporting whether it changed and what it was, as
/// whatsmeow's `PutPushName` does.
fn replace_name(name: &mut String, new_name: &str) -> (bool, (bool, String)) {
    if name == new_name {
        return (false, (false, String::new()));
    }
    let previous = std::mem::replace(name, new_name.to_owned());
    (true, (true, previous))
}

#[async_trait]
impl ContactStore for PgWhatsAppStore {
    async fn put_push_name(
        &self,
        user: &Jid,
        push_name: &str,
    ) -> Result<(bool, String), StoreError> {
        Ok(self
            .update_record(
                StoreName::Contact,
                user.to_string(),
                |record: &mut ContactRecord| replace_name(&mut record.push_name, push_name),
            )
            .await?)
    }

    async fn put_business_name(
        &self,
        user: &Jid,
        business_name: &str,
    ) -> Result<(bool, String), StoreError> {
        Ok(self
            .update_record(
                StoreName::Contact,
                user.to_string(),
                |record: &mut ContactRecord| replace_name(&mut record.business_name, business_name),
            )
            .await?)
    }

    async fn put_contact_name(
        &self,
        user: &Jid,
        full_name: &str,
        first_name: &str,
    ) -> Result<(), StoreError> {
        self.update_record(
            StoreName::Contact,
            user.to_string(),
            |record: &mut ContactRecord| {
                let changed = record.full_name != full_name || record.first_name != first_name;
                full_name.clone_into(&mut record.full_name);
                first_name.clone_into(&mut record.first_name);
                (changed, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn put_all_contact_names(&self, contacts: &[ContactEntry]) -> Result<(), StoreError> {
        // A contact listed twice keeps its last names, as whatsmeow dedupes.
        let names: HashMap<String, &ContactEntry> = contacts
            .iter()
            .map(|entry| (entry.jid.to_string(), entry))
            .collect();
        let keys = names.keys().cloned().collect();
        self.update_records(
            StoreName::Contact,
            keys,
            |key, record: &mut ContactRecord| {
                let Some(entry) = names.get(key) else {
                    return (false, ());
                };
                let changed =
                    record.full_name != entry.full_name || record.first_name != entry.first_name;
                record.full_name.clone_from(&entry.full_name);
                record.first_name.clone_from(&entry.first_name);
                (changed, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn put_many_redacted_phones(
        &self,
        entries: &[RedactedPhoneEntry],
    ) -> Result<(), StoreError> {
        let phones: HashMap<String, &str> = entries
            .iter()
            .map(|entry| (entry.jid.to_string(), entry.redacted_phone.as_str()))
            .collect();
        let keys = phones.keys().cloned().collect();
        self.update_records(
            StoreName::Contact,
            keys,
            |key, record: &mut ContactRecord| {
                let Some(phone) = phones.get(key) else {
                    return (false, ());
                };
                let changed = record.redacted_phone != *phone;
                (*phone).clone_into(&mut record.redacted_phone);
                (changed, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn get_contact(&self, user: &Jid) -> Result<Option<ContactInfo>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::Contact, &user.to_string())
            .await?
            .map(|plaintext| decode::<ContactRecord>(&plaintext).map(ContactInfo::from))
            .transpose()?)
    }

    async fn get_all_contacts(&self) -> Result<HashMap<Jid, ContactInfo>, StoreError> {
        Ok(self
            .list_values(&self.pool, StoreName::Contact, "")
            .await?
            .into_iter()
            .map(|(jid, plaintext)| {
                let jid: Jid = jid.parse().map_err(|_| WhatsAppStoreError::Malformed)?;
                Ok((jid, decode::<ContactRecord>(&plaintext)?.into()))
            })
            .collect::<Result<_, WhatsAppStoreError>>()?)
    }
}

#[async_trait]
impl ChatSettingsStore for PgWhatsAppStore {
    async fn put_muted_until(
        &self,
        chat: &Jid,
        muted_until: Option<DateTime<Utc>>,
    ) -> Result<(), StoreError> {
        self.update_record(
            StoreName::ChatSettings,
            chat.to_string(),
            |record: &mut ChatSettingsRecord| {
                record.muted_until = muted_until;
                (true, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn put_pinned(&self, chat: &Jid, pinned: bool) -> Result<(), StoreError> {
        self.update_record(
            StoreName::ChatSettings,
            chat.to_string(),
            |record: &mut ChatSettingsRecord| {
                record.pinned = pinned;
                (true, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn put_archived(&self, chat: &Jid, archived: bool) -> Result<(), StoreError> {
        self.update_record(
            StoreName::ChatSettings,
            chat.to_string(),
            |record: &mut ChatSettingsRecord| {
                record.archived = archived;
                (true, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn put_wasa_root_secret_id(&self, chat: &Jid, id: &MessageId) -> Result<(), StoreError> {
        self.update_record(
            StoreName::ChatSettings,
            chat.to_string(),
            |record: &mut ChatSettingsRecord| {
                record.wasa_root_secret_id = Some(id.clone());
                (true, ())
            },
        )
        .await?;
        Ok(())
    }

    async fn get_wasa_root_secret_id(&self, chat: &Jid) -> Result<Option<MessageId>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::ChatSettings, &chat.to_string())
            .await?
            .map(|plaintext| decode::<ChatSettingsRecord>(&plaintext))
            .transpose()?
            .and_then(|record| record.wasa_root_secret_id))
    }

    /// Like whatsmeow, a chat has settings once any of them (including its
    /// WASA root secret ID) was stored.
    async fn get_chat_settings(&self, chat: &Jid) -> Result<Option<LocalChatSettings>, StoreError> {
        Ok(self
            .get_value(&self.pool, StoreName::ChatSettings, &chat.to_string())
            .await?
            .map(|plaintext| {
                decode::<ChatSettingsRecord>(&plaintext).map(|record| LocalChatSettings {
                    muted_until: record.muted_until,
                    pinned: record.pinned,
                    archived: record.archived,
                })
            })
            .transpose()?)
    }
}
