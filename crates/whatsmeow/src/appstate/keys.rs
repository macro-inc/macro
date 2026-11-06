// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/keys.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Arc;

use super::decode::PatchList;
use super::errors::AppStateError;
use crate::store::{AppStateStore, AppStateSyncKeyStore, Device, StoreError};
use crate::util::hkdfutil;

/// A type of app state patch.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WaPatchName(pub Cow<'static, str>);

impl WaPatchName {
    /// The name as a string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for WaPatchName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<String> for WaPatchName {
    fn from(name: String) -> Self {
        WaPatchName(Cow::Owned(name))
    }
}

/// Contains the user's settings like push name and locale.
pub const WA_PATCH_CRITICAL_BLOCK: WaPatchName = WaPatchName(Cow::Borrowed("critical_block"));
/// Contains the user's contact list.
pub const WA_PATCH_CRITICAL_UNBLOCK_LOW: WaPatchName =
    WaPatchName(Cow::Borrowed("critical_unblock_low"));
/// Contains some local chat settings like pin, archive status, and the
/// setting of whether to unarchive chats when messages come in.
pub const WA_PATCH_REGULAR_LOW: WaPatchName = WaPatchName(Cow::Borrowed("regular_low"));
/// Contains more local chat settings like mute status and starred messages.
pub const WA_PATCH_REGULAR_HIGH: WaPatchName = WaPatchName(Cow::Borrowed("regular_high"));
/// Contains protocol info about app state patches like key expiration.
pub const WA_PATCH_REGULAR: WaPatchName = WaPatchName(Cow::Borrowed("regular"));

/// All currently known patch state names.
pub const ALL_PATCH_NAMES: [WaPatchName; 5] = [
    WA_PATCH_CRITICAL_BLOCK,
    WA_PATCH_CRITICAL_UNBLOCK_LOW,
    WA_PATCH_REGULAR_HIGH,
    WA_PATCH_REGULAR,
    WA_PATCH_REGULAR_LOW,
];

// Constants for the regular_low app state indexes.

/// regular_low index.
pub const INDEX_PIN: &str = "pin_v1";
/// regular_low index.
pub const INDEX_RECENT_EMOJI_WEIGHTS_ACTION: &str = "recent_emoji_weights_action";
/// regular_low index.
pub const INDEX_ARCHIVE: &str = "archive";
/// regular_low index.
pub const INDEX_SENTINEL: &str = "sentinel";
/// regular_low index.
pub const INDEX_MARK_CHAT_AS_READ: &str = "markChatAsRead";
/// regular_low index.
pub const INDEX_SETTING_UNARCHIVE_CHATS: &str = "setting_unarchiveChats";
/// regular_low index.
pub const INDEX_ANDROID_UNSUPPORTED_ACTIONS: &str = "android_unsupported_actions";
/// regular_low index.
pub const INDEX_TIME_FORMAT: &str = "time_format";
/// regular_low index.
pub const INDEX_NUX: &str = "nux";
/// regular_low index.
pub const INDEX_PRIMARY_VERSION: &str = "primary_version";
/// regular_low index.
pub const INDEX_FAVORITE_STICKER: &str = "favoriteSticker";
/// regular_low index.
pub const INDEX_REMOVE_RECENT_STICKER: &str = "removeRecentSticker";
/// regular_low index.
pub const INDEX_BOT_WELCOME_REQUEST: &str = "bot_welcome_request";
/// regular_low index.
pub const INDEX_PAYMENT_INFO: &str = "payment_info";
/// regular_low index.
pub const INDEX_CUSTOM_PAYMENT_METHODS: &str = "custom_payment_methods";
/// regular_low index.
pub const INDEX_LOCK: &str = "lock";
/// regular_low index.
pub const INDEX_SETTING_CHAT_LOCK: &str = "setting_chatLock";
/// regular_low index.
pub const INDEX_DEVICE_CAPABILITIES: &str = "device_capabilities";
/// regular_low index.
pub const INDEX_DEVICE_CAPABILITIES_V2: &str = "device_capabilities_v2";
/// regular_low index.
pub const INDEX_NOTE_EDIT: &str = "note_edit";
/// regular_low index.
pub const INDEX_MERCHANT_PAYMENT_PARTNER: &str = "merchant_payment_partner";
/// regular_low index.
pub const INDEX_PAYMENT_TOS: &str = "payment_tos";
/// regular_low index.
pub const INDEX_AI_THREAD_RENAME: &str = "ai_thread_rename";
/// regular_low index.
pub const INDEX_INTERACTIVE_MESSAGE_ACTION: &str = "interactive_message_action";
/// regular_low index.
pub const INDEX_SETTINGS_SYNC: &str = "settings_sync";
/// regular_low index.
pub const INDEX_OUT_CONTACT: &str = "out_contact";
/// regular_low index.
pub const INDEX_CUSTOMER_DATA: &str = "customer_data";
/// regular_low index.
pub const INDEX_THREAD_PIN: &str = "thread_pin";
/// regular_low index.
pub const INDEX_SETTING_AUTO_ORGANIZE_BUSINESS_CHAT: &str = "setting_autoOrganizeBusinessChat";
/// regular_low index.
pub const INDEX_COEX_V2_VERSION: &str = "coexV2Version";
/// regular_low index.
pub const INDEX_LOCK_MESSAGE: &str = "lock_message";
/// regular_low index.
pub const INDEX_CONTACT_MANAGER_METADATA: &str = "contact_manager_metadata";
/// regular_low index.
pub const INDEX_BUSINESS_FOLDER_ACTIVATION: &str = "business_folder_activation";
/// regular_low index.
pub const INDEX_GROUP_HISTORY_TOGGLE: &str = "group_history_toggle";
/// regular_low index.
pub const INDEX_BB_PRO_PENDING_CUSTOMER_BASE_ACTION: &str = "bb_pro_pending_customer_base_action";
/// regular_low index.
pub const INDEX_COMMUNITY_NESTING_STATE: &str = "community_nesting_state";

// Constants for the regular app state indexes.

/// regular index.
pub const INDEX_QUICK_REPLY: &str = "quick_reply";
/// regular index.
pub const INDEX_LABEL_ASSOCIATION_MESSAGE: &str = "label_message";
/// regular index.
pub const INDEX_LABEL_EDIT: &str = "label_edit";
/// regular index.
pub const INDEX_LABEL_ASSOCIATION_CHAT: &str = "label_jid";
/// regular index.
pub const INDEX_PRIMARY_FEATURE: &str = "primary_feature";
/// regular index.
pub const INDEX_DEVICE_AGENT: &str = "deviceAgent";
/// regular index.
pub const INDEX_SUBSCRIPTION: &str = "subscription";
/// regular index.
pub const INDEX_AGENT_CHAT_ASSIGNMENT: &str = "agentChatAssignment";
/// regular index.
pub const INDEX_AGENT_CHAT_ASSIGNMENT_OPENED_STATUS: &str = "agentChatAssignmentOpenedStatus";
/// regular index.
pub const INDEX_PN_FOR_LID_CHAT: &str = "pnForLidChat";
/// regular index.
pub const INDEX_MARKETING_MESSAGE: &str = "marketingMessage";
/// regular index.
pub const INDEX_MARKETING_MESSAGE_BROADCAST: &str = "marketingMessageBroadcast";
/// regular index.
pub const INDEX_EXTERNAL_WEB_BETA: &str = "external_web_beta";
/// regular index.
pub const INDEX_SETTING_RELAY_ALL_CALLS: &str = "setting_relayAllCalls";
/// regular index.
pub const INDEX_CALL_LOG: &str = "call_log";
/// regular index.
pub const INDEX_DELETE_INDIVIDUAL_CALL_LOG: &str = "delete_individual_call_log";
/// regular index.
pub const INDEX_LABEL_REORDERING: &str = "label_reordering";
/// regular index.
pub const INDEX_SETTING_DISABLE_LINK_PREVIEWS: &str = "setting_disableLinkPreviews";
/// regular index.
pub const INDEX_USERNAME_CHAT_START_MODE: &str = "usernameChatStartMode";
/// regular index.
pub const INDEX_NOTIFICATION_ACTIVITY_SETTING: &str = "notificationActivitySetting";
/// regular index.
pub const INDEX_SETTING_CHANNELS_PERSONALISED_RECOMMENDATION_OPTOUT: &str =
    "setting_channels_personalised_recommendation_optout";
/// regular index.
pub const INDEX_BROADCAST_JID: &str = "broadcast_jid";
/// regular index.
pub const INDEX_DETECTED_OUTCOMES_STATUS_ACTION: &str = "detected_outcomes_status_action";
/// regular index.
pub const INDEX_BUSINESS_BROADCAST_LIST: &str = "business_broadcast_list";
/// regular index.
pub const INDEX_MUSIC_USER_ID: &str = "music_user_id";
/// regular index.
pub const INDEX_AVATAR_UPDATED_ACTION: &str = "avatar_updated_action";
/// regular index.
pub const INDEX_GALAXY_FLOW_ACTION: &str = "galaxy_flow_action";
/// regular index.
pub const INDEX_NEWSLETTER_SAVED_INTERESTS: &str = "newsletter_saved_interests";
/// regular index.
pub const INDEX_SHARE_OWN_PN: &str = "shareOwnPn";
/// regular index.
pub const INDEX_BROADCAST: &str = "broadcast";
/// regular index.
pub const INDEX_SUBSCRIPTIONS_SYNC: &str = "subscriptions_sync_v2";
/// regular index.
pub const INDEX_LABEL_SUBLIST: &str = "label_sublist";
/// regular index.
pub const INDEX_CTWA_MESSAGE_RECEIVED: &str = "ctwa_message_received";

// Constants for the regular_high app state indexes.

/// regular_high index.
pub const INDEX_STAR: &str = "star";
/// regular_high index.
pub const INDEX_MUTE: &str = "mute";
/// regular_high index.
pub const INDEX_DELETE_MESSAGE_FOR_ME: &str = "deleteMessageForMe";
/// regular_high index.
pub const INDEX_CLEAR_CHAT: &str = "clearChat";
/// regular_high index.
pub const INDEX_DELETE_CHAT: &str = "deleteChat";
/// regular_high index.
pub const INDEX_USER_STATUS_MUTE: &str = "userStatusMute";
/// regular_high index.
pub const INDEX_UGC_BOT: &str = "ugc_bot";
/// regular_high index.
pub const INDEX_STATUS_PRIVACY: &str = "status_privacy";
/// regular_high index.
pub const INDEX_FAVORITES: &str = "favorites";
/// regular_high index.
pub const INDEX_WAFFLE_ACCOUNT_LINK_STATE: &str = "waffle_account_link_state";
/// regular_high index.
pub const INDEX_CTWA_PER_CUSTOMER_DATA_SHARING: &str = "ctwaPerCustomerDataSharing";
/// regular_high index.
pub const INDEX_MAIBA_AI_FEATURES_CONTROL: &str = "maiba_ai_features_control";
/// regular_high index.
pub const INDEX_STATUS_POST_OPT_IN_NOTIFICATION_PREFERENCES_ACTION: &str =
    "status_post_opt_in_notification_preferences_action";
/// regular_high index.
pub const INDEX_PRIVATE_PROCESSING_SETTING: &str = "private_processing_setting";
/// regular_high index.
pub const INDEX_AI_THREAD_DELETE: &str = "ai_thread_delete";
/// regular_high index.
pub const INDEX_NCT_SALT_SYNC: &str = "nct_salt_sync";
/// regular_high index.
pub const INDEX_BIZ_AI_SETTINGS_NUDGE_ACTION: &str = "biz_ai_settings_nudge";
/// regular_high index.
pub const INDEX_WASA_ROOT_SECRET_ACTION: &str = "wasa_root_secret";
/// regular_high index.
pub const INDEX_SHARED_DEVICE_ALLOWLIST: &str = "shared_device_allowlist";
/// regular_high index.
pub const INDEX_SHARED_DEVICE_SECRET: &str = "shared_device_secret";

// Constants for the critical_unblock_low app state indexes.

/// critical_unblock_low index.
pub const INDEX_CONTACT: &str = "contact";
/// critical_unblock_low index.
pub const INDEX_LID_CONTACT: &str = "lid_contact";

// Constants for the critical_block app state indexes.

/// critical_block index.
pub const INDEX_SETTING_SECURITY_NOTIFICATION: &str = "setting_securityNotification";
/// critical_block index.
pub const INDEX_SETTING_PUSH_NAME: &str = "setting_pushName";
/// critical_block index.
pub const INDEX_SETTING_LOCALE: &str = "setting_locale";
/// critical_block index.
pub const INDEX_GENERATED_WUI: &str = "generated_wui";

/// Encodes and decodes app state patches with a device's app state stores.
///
/// Go keeps the `*store.Device` and reads `Store.AppStateKeys` and
/// `Store.AppState` on every call; this holds those two handles, cloned from
/// the device in [`Processor::new`]. After `Device::set_all_stores` or
/// `Device::delete` swaps the device's stores, make a new processor. Go's
/// logger is replaced by `tracing`.
pub struct Processor {
    /// Expanded keys by key ID. A tokio lock, because Go holds the lock across
    /// the store lookup.
    pub(super) key_cache: tokio::sync::Mutex<HashMap<Vec<u8>, ExpandedAppStateKeys>>,
    /// The device's app state sync keys (Go's `Store.AppStateKeys`).
    pub app_state_keys: Arc<dyn AppStateSyncKeyStore>,
    /// The device's app state versions and mutation MACs (Go's
    /// `Store.AppState`).
    pub app_state: Arc<dyn AppStateStore>,
}

impl Processor {
    /// A processor for the device's app state stores.
    pub fn new(store: &Device) -> Self {
        Processor {
            key_cache: tokio::sync::Mutex::new(HashMap::new()),
            app_state_keys: store.app_state_keys.clone(),
            app_state: store.app_state.clone(),
        }
    }
}

/// The keys derived from one app state sync key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExpandedAppStateKeys {
    /// Key for the index MACs.
    pub index: [u8; 32],
    /// Key for encrypting mutation values.
    pub value_encryption: [u8; 32],
    /// Key for the value MACs.
    pub value_mac: [u8; 32],
    /// Key for the snapshot MACs.
    pub snapshot_mac: [u8; 32],
    /// Key for the patch MACs.
    pub patch_mac: [u8; 32],
}

/// Getting an app state key failed.
#[derive(Debug, thiserror::Error)]
pub enum GetKeyError {
    /// The store failed.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// The store has no such key ([`AppStateError::KeyNotFound`]).
    #[error("{}", AppStateError::KeyNotFound)]
    KeyNotFound,
}

impl GetKeyError {
    /// The wrapped [`AppStateError`], like Go's `errors.Is`.
    pub fn sentinel(&self) -> Option<AppStateError> {
        match self {
            GetKeyError::Store(_) => None,
            GetKeyError::KeyNotFound => Some(AppStateError::KeyNotFound),
        }
    }
}

pub(super) fn expand_app_state_keys(key_data: &[u8]) -> ExpandedAppStateKeys {
    let expanded = hkdfutil::sha256(key_data, &[], b"WhatsApp Mutation Keys", 160);
    let mut keys = [[0; 32]; 5];
    for (key, chunk) in keys.iter_mut().zip(expanded.chunks_exact(32)) {
        key.copy_from_slice(chunk);
    }
    let [index, value_encryption, value_mac, snapshot_mac, patch_mac] = keys;
    ExpandedAppStateKeys {
        index,
        value_encryption,
        value_mac,
        snapshot_mac,
        patch_mac,
    }
}

impl Processor {
    pub(super) async fn get_app_state_key(
        &self,
        key_id: &[u8],
    ) -> Result<ExpandedAppStateKeys, GetKeyError> {
        let mut key_cache = self.key_cache.lock().await;
        if let Some(keys) = key_cache.get(key_id) {
            return Ok(*keys);
        }
        let key_data = self
            .app_state_keys
            .get_app_state_sync_key(key_id)
            .await?
            .ok_or(GetKeyError::KeyNotFound)?;
        let keys = expand_app_state_keys(&key_data.data);
        key_cache.insert(key_id.to_vec(), keys);
        Ok(keys)
    }

    /// The IDs of the keys the patch list uses that aren't in the store, in
    /// order of first use. Lookup failures are logged and don't count as
    /// missing.
    pub async fn get_missing_key_ids(&self, pl: &PatchList) -> Vec<Vec<u8>> {
        let mut cache = HashSet::new();
        let mut missing_keys = Vec::new();
        let mut key_ids: Vec<Option<&[u8]>> = Vec::new();
        if let Some(snapshot) = &pl.snapshot {
            key_ids.push(snapshot.key_id.as_ref().and_then(|key| key.id.as_deref()));
            for record in &snapshot.records {
                key_ids.push(record.key_id.as_ref().and_then(|key| key.id.as_deref()));
            }
        }
        for patch in &pl.patches {
            key_ids.push(patch.key_id.as_ref().and_then(|key| key.id.as_deref()));
        }
        for key_id in key_ids.into_iter().flatten() {
            if !cache.insert(key_id) {
                continue;
            }
            match self.app_state_keys.get_app_state_sync_key(key_id).await {
                Ok(Some(_)) => {}
                Ok(None) => missing_keys.push(key_id.to_vec()),
                Err(error) => tracing::warn!(
                    key_id = %hex::encode_upper(key_id),
                    error = %error,
                    "Error fetching key while checking if it's missing"
                ),
            }
        }
        missing_keys
    }
}

#[cfg(test)]
mod test;
