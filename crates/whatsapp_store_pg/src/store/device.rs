//! The device's own data (its keys, JIDs and names), and building a whatsmeow
//! [`Device`] backed by this store.

#[cfg(test)]
mod test;

use std::sync::Arc;

use async_trait::async_trait;
use prost::Message;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use whatsmeow::proto::wa_adv::AdvSignedDeviceIdentity;
use whatsmeow::signal::CurveSignatures;
use whatsmeow::store::{Device, DeviceContainer, StoreError};
use whatsmeow::types::Jid;
use whatsmeow::util::keys::{PreKey, new_key_pair, new_key_pair_from_private_key};

use super::PgWhatsAppStore;
use crate::cipher::StoreName;
use crate::error::WhatsAppStoreError;

/// The device record is one value per account.
const DEVICE_KEY: &str = "";

/// The ID of the signed prekey of a new device, as whatsmeow numbers it.
const SIGNED_PRE_KEY_ID: u32 = 1;

/// A device as sealed in its value. Public keys are derived from the private
/// ones on load, as whatsmeow's `sqlstore` does.
#[derive(Serialize, Deserialize)]
struct DeviceRecord {
    noise_private_key: [u8; 32],
    identity_private_key: [u8; 32],
    signed_pre_key_private_key: [u8; 32],
    signed_pre_key_id: u32,
    signed_pre_key_signature: Option<Vec<u8>>,
    registration_id: u32,
    adv_secret_key: Vec<u8>,
    jid: String,
    lid: String,
    /// The protobuf `AdvSignedDeviceIdentity`, when known.
    account: Option<Vec<u8>>,
    platform: String,
    business_name: String,
    push_name: String,
    lid_migration_timestamp: i64,
    companion_meta_nonce: String,
    facebook_uuid: Option<Uuid>,
}

impl PgWhatsAppStore {
    /// The account's device with every store backed by this one: the saved
    /// device, or a new unpaired one (not saved until whatsmeow pairs and
    /// calls [`Device::save`]), as whatsmeow's `Container` hands out.
    ///
    /// # Errors
    /// If the stored device fails to decrypt or decode, or the database fails.
    #[tracing::instrument(
        name = "whatsapp_store.load_device",
        skip_all,
        fields(account_id = %self.account_id, initialized),
        err
    )]
    pub async fn load_device(
        self: &Arc<Self>,
        signatures: &impl CurveSignatures,
    ) -> Result<Device, WhatsAppStoreError> {
        let stored = self
            .get_value(&self.pool, StoreName::Device, DEVICE_KEY)
            .await?;
        tracing::Span::current().record("initialized", stored.is_some());
        let Some(plaintext) = stored else {
            let identity_key = new_key_pair();
            let signed_pre_key = identity_key.create_signed_pre_key(signatures, SIGNED_PRE_KEY_ID);
            return Ok(self.device(DeviceParts {
                noise_key: new_key_pair(),
                identity_key,
                signed_pre_key,
                registration_id: rand::random(),
                adv_secret_key: rand::random::<[u8; 32]>().to_vec(),
                id: None,
                lid: Jid::default(),
                account: None,
                platform: String::new(),
                business_name: String::new(),
                push_name: String::new(),
                lid_migration_timestamp: 0,
                companion_meta_nonce: String::new(),
                facebook_uuid: None,
                initialized: false,
            }));
        };
        let record: DeviceRecord =
            postcard::from_bytes(&plaintext).map_err(|_| WhatsAppStoreError::Malformed)?;
        let signature = record
            .signed_pre_key_signature
            .map(|signature| <[u8; 64]>::try_from(signature.as_slice()))
            .transpose()
            .map_err(|_| WhatsAppStoreError::Malformed)?;
        let parse_jid = |jid: &str| -> Result<Jid, WhatsAppStoreError> {
            jid.parse().map_err(|_| WhatsAppStoreError::Malformed)
        };
        Ok(self.device(DeviceParts {
            noise_key: new_key_pair_from_private_key(record.noise_private_key),
            identity_key: new_key_pair_from_private_key(record.identity_private_key),
            signed_pre_key: PreKey {
                key_pair: new_key_pair_from_private_key(record.signed_pre_key_private_key),
                key_id: record.signed_pre_key_id,
                signature,
            },
            registration_id: record.registration_id,
            adv_secret_key: record.adv_secret_key,
            id: Some(parse_jid(&record.jid)?),
            lid: parse_jid(&record.lid)?,
            account: record
                .account
                .map(|account| AdvSignedDeviceIdentity::decode(account.as_slice()))
                .transpose()
                .map_err(|_| WhatsAppStoreError::Malformed)?,
            platform: record.platform,
            business_name: record.business_name,
            push_name: record.push_name,
            lid_migration_timestamp: record.lid_migration_timestamp,
            companion_meta_nonce: record.companion_meta_nonce,
            facebook_uuid: record.facebook_uuid,
            initialized: true,
        }))
    }

    fn device(self: &Arc<Self>, parts: DeviceParts) -> Device {
        Device {
            noise_key: parts.noise_key,
            identity_key: parts.identity_key,
            signed_pre_key: parts.signed_pre_key,
            registration_id: parts.registration_id,
            adv_secret_key: parts.adv_secret_key,
            id: parts.id,
            lid: parts.lid,
            account: parts.account,
            platform: parts.platform,
            business_name: parts.business_name,
            push_name: parts.push_name,
            lid_migration_timestamp: parts.lid_migration_timestamp,
            companion_meta_nonce: parts.companion_meta_nonce,
            facebook_uuid: parts.facebook_uuid,
            initialized: parts.initialized,
            deleted: false,
            identities: self.clone(),
            sessions: self.clone(),
            pre_keys: self.clone(),
            sender_keys: self.clone(),
            app_state_keys: self.clone(),
            app_state: self.clone(),
            contacts: self.clone(),
            chat_settings: self.clone(),
            msg_secrets: self.clone(),
            privacy_tokens: self.clone(),
            nct_salt: self.clone(),
            event_buffer: self.clone(),
            lids: self.clone(),
            container: self.clone(),
        }
    }
}

/// The data fields of a [`Device`], without its store handles.
struct DeviceParts {
    noise_key: whatsmeow::util::keys::KeyPair,
    identity_key: whatsmeow::util::keys::KeyPair,
    signed_pre_key: PreKey,
    registration_id: u32,
    adv_secret_key: Vec<u8>,
    id: Option<Jid>,
    lid: Jid,
    account: Option<AdvSignedDeviceIdentity>,
    platform: String,
    business_name: String,
    push_name: String,
    lid_migration_timestamp: i64,
    companion_meta_nonce: String,
    facebook_uuid: Option<Uuid>,
    initialized: bool,
}

#[async_trait]
impl DeviceContainer for PgWhatsAppStore {
    #[tracing::instrument(
        name = "whatsapp_store.put_device",
        skip_all,
        fields(account_id = %self.account_id),
        err
    )]
    async fn put_device(&self, store: &Device) -> Result<(), StoreError> {
        let Some(jid) = &store.id else {
            return Err(StoreError::InvalidArgument(
                "device JID must be known before accessing database".to_owned(),
            ));
        };
        let record = DeviceRecord {
            noise_private_key: store.noise_key.private,
            identity_private_key: store.identity_key.private,
            signed_pre_key_private_key: store.signed_pre_key.key_pair.private,
            signed_pre_key_id: store.signed_pre_key.key_id,
            signed_pre_key_signature: store
                .signed_pre_key
                .signature
                .map(|signature| signature.to_vec()),
            registration_id: store.registration_id,
            adv_secret_key: store.adv_secret_key.clone(),
            jid: jid.to_string(),
            lid: store.lid.to_string(),
            account: store.account.as_ref().map(Message::encode_to_vec),
            platform: store.platform.clone(),
            business_name: store.business_name.clone(),
            push_name: store.push_name.clone(),
            lid_migration_timestamp: store.lid_migration_timestamp,
            companion_meta_nonce: store.companion_meta_nonce.clone(),
            facebook_uuid: store.facebook_uuid,
        };
        let plaintext =
            postcard::to_allocvec(&record).map_err(|_| WhatsAppStoreError::Malformed)?;
        Ok(self
            .put_one(StoreName::Device, DEVICE_KEY.to_owned(), plaintext)
            .await?)
    }

    /// Deletes the device row, which cascades to every key, session and value
    /// of the account. This store is unusable afterwards; opening the account
    /// again generates a new data key.
    #[tracing::instrument(
        name = "whatsapp_store.delete_device",
        skip_all,
        fields(account_id = %self.account_id),
        err
    )]
    async fn delete_device(&self, _store: &Device) -> Result<(), StoreError> {
        let mut transaction = self.begin_write().await?;
        sqlx::query!(
            r#"
            DELETE FROM whatsapp_device
            WHERE account_id = $1
            "#,
            self.account_id,
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
