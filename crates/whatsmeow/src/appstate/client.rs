// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// The top-level `appstate.go` (the client side of app state: fetching,
// applying, sending) lives here rather than in `src/appstate.rs`, which is
// the `appstate` package. Also here: `handleAppStateSyncKeyShare` from
// `message.go`, `handleAppStateNotification` from `notification.go`, and
// `storeNCTSalt`/`clearNCTSalt` from `cstoken.go` (inlined).
//
// Deviations:
// - Go dispatches the same `error` value in `AppStateSyncError` that it
//   returns; `ClientError` isn't `Clone`, so the event carries the message.
// - `ErrAppStateUpdate` wraps its detail instead of being wrapped by it, so
//   `ClientError::is(&ClientError::AppStateUpdate)` holds; the message order
//   differs from Go's.
// - Mutation logs carry the index kind and versions only, never the index
//   (JIDs) or the action.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;

use super::{
    ALL_PATCH_NAMES, AppStateError, DownloadExternal, HashState, INDEX_ARCHIVE, INDEX_CLEAR_CHAT,
    INDEX_CONTACT, INDEX_DELETE_CHAT, INDEX_DELETE_MESSAGE_FOR_ME, INDEX_LABEL_ASSOCIATION_CHAT,
    INDEX_LABEL_ASSOCIATION_MESSAGE, INDEX_LABEL_EDIT, INDEX_MARK_CHAT_AS_READ, INDEX_MUTE,
    INDEX_NCT_SALT_SYNC, INDEX_PIN, INDEX_SETTING_PUSH_NAME, INDEX_SETTING_UNARCHIVE_CHATS,
    INDEX_STAR, INDEX_USER_STATUS_MUTE, INDEX_WASA_ROOT_SECRET_ACTION, Mutation, PatchInfo,
    PatchList, WA_PATCH_CRITICAL_UNBLOCK_LOW, WaPatchName, parse_patch_list, parse_recovery,
};
use crate::binary::{Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::{ClientError, DisconnectedError, element_missing};
use crate::proto::wa_e2e::peer_data_operation_request_message::SyncDCollectionFatalRecoveryRequest;
use crate::proto::wa_e2e::peer_data_operation_request_response_message::PeerDataOperationResult;
use crate::proto::wa_e2e::{
    self, AppStateFatalExceptionNotification, AppStateSyncKeyId, AppStateSyncKeyRequest,
    AppStateSyncKeyShare, PeerDataOperationRequestMessage, PeerDataOperationRequestType,
    ProtocolMessage, protocol_message,
};
use crate::proto::wa_server_sync::ExternalBlobReference;
use crate::proto::wa_server_sync::syncd_mutation::SyncdOperation;
use crate::proto::wa_sync_action::wasa_root_secret_action::RootSecretEntry;
use crate::proto::wa_sync_action::wasa_root_secret_action::root_secret_entry::Status as RootSecretStatus;
use crate::request::{InfoQuery, IqType};
use crate::store::{AppStateSyncKey, ContactEntry, MUTED_FOREVER, MessageSecretInsert};
use crate::types::events::{
    AppState, AppStateSyncComplete, AppStateSyncError, Archive, ClearChat, Contact, DeleteChat,
    DeleteForMe, Event, LabelAssociationChat, LabelAssociationMessage, LabelEdit, MarkChatAsRead,
    Mute, Pin, PushNameSetting, Star, UnarchiveChatsSetting, UserStatusMute,
};
use crate::types::{Jid, SERVER_JID, parse_jid};

/// How long to wait before asking the phone for the same missing key again.
const KEY_REQUEST_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Go's `types.ParseJID` with the error ignored: the empty JID.
fn parse_jid_or_empty(jid: &str) -> Jid {
    parse_jid(jid).unwrap_or_default()
}

/// Go's `time.UnixMilli`; out of range is the Unix epoch.
fn unix_milli(milliseconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(milliseconds).unwrap_or_default()
}

#[async_trait]
impl DownloadExternal for Client {
    /// `downloadExternalAppStateBlob`: downloads through the media hosts.
    async fn download_external(
        &self,
        reference: &ExternalBlobReference,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(self.download(reference).await?)
    }
}

impl Client {
    /// Fetches updates to the given type of app state and dispatches their
    /// events. With `full_sync`, the cached state is removed and every patch
    /// is fetched again; with `only_if_not_synced`, nothing happens when the
    /// collection was synced before.
    pub async fn fetch_app_state(
        self: &Arc<Self>,
        name: &WaPatchName,
        full_sync: bool,
        only_if_not_synced: bool,
    ) -> Result<(), ClientError> {
        let events = self
            .fetch_app_state_events(name, full_sync, only_if_not_synced)
            .await?;
        for event in events {
            self.dispatch_event(event).await;
        }
        Ok(())
    }

    /// `fetchAppState`: syncs the collection and returns the events to
    /// dispatch.
    #[tracing::instrument(
        name = "whatsmeow.app_state.fetch",
        skip_all,
        fields(name = %name, full_sync, only_if_not_synced),
        err
    )]
    async fn fetch_app_state_events(
        self: &Arc<Self>,
        name: &WaPatchName,
        mut full_sync: bool,
        only_if_not_synced: bool,
    ) -> Result<Vec<Event>, ClientError> {
        let _sync = self.app_state_sync_lock.lock().await;
        let app_state = Arc::clone(&self.store.read().await.app_state);
        if full_sync {
            app_state
                .delete_app_state_version(name.as_str())
                .await
                .map_err(|error| {
                    ClientError::from(error)
                        .wrap(format!("failed to reset app state {name} version"))
                })?;
        }
        let (version, hash) = app_state
            .get_app_state_version(name.as_str())
            .await
            .map_err(|error| {
                ClientError::from(error).wrap(format!("failed to get app state {name} version"))
            })?;
        if version == 0 {
            full_sync = true;
        } else if only_if_not_synced {
            return Ok(Vec::new());
        }

        let mut state = HashState { version, hash };
        let mut has_more = true;
        let mut want_snapshot = full_sync;
        let mut events = Vec::new();
        let emit = !full_sync || self.config.emit_app_state_events_on_full_sync;
        while has_more {
            let patches = match self
                .fetch_app_state_patches(name, state.version, want_snapshot)
                .await
            {
                Ok(patches) => patches,
                Err(error) => {
                    if full_sync && !self.background.is_cancelled() {
                        self.dispatch_event(Event::AppStateSyncError(AppStateSyncError {
                            name: name.clone(),
                            error: Arc::new(ClientError::Other(error.to_string())),
                            full_sync,
                        }))
                        .await;
                    }
                    return Err(error.wrap(format!("failed to fetch app state {name} patches")));
                }
            };
            if !want_snapshot && patches.snapshot.is_some() {
                return Err(ClientError::Other(format!(
                    "server unexpectedly returned snapshot for {name} without asking"
                )));
            } else if patches.snapshot.is_some() && state != HashState::default() {
                return Err(ClientError::Other(format!(
                    "unexpected non-empty input state (v{}) for {name} when applying snapshot",
                    state.version
                )));
            }
            want_snapshot = false;
            has_more = patches.has_more_patches;
            state = self
                .apply_app_state_patches(
                    name,
                    state,
                    &patches,
                    full_sync,
                    emit.then_some(&mut events),
                )
                .await?;
        }
        if full_sync {
            tracing::debug!(name = %name, version = state.version, "full sync of app state completed");
            events.push(Event::AppStateSyncComplete(AppStateSyncComplete {
                name: name.clone(),
                version: state.version,
                recovery: false,
            }));
        } else {
            tracing::debug!(name = %name, from = version, to = state.version, "synced app state");
        }
        Ok(events)
    }

    /// `handleAppStateRecovery`: applies a recovery snapshot the phone sent
    /// in response to [`build_app_state_recovery_request`]. Returns `false`
    /// when an event handler failed.
    #[expect(dead_code, reason = "called by the message receive path, ported next")]
    pub(crate) async fn handle_app_state_recovery(
        &self,
        request_id: &str,
        result: &[PeerDataOperationResult],
    ) -> bool {
        let Some(response) = result
            .first()
            .and_then(|first| first.syncd_snapshot_fatal_recovery_response.as_ref())
        else {
            tracing::warn!(request_id, "no app state recovery data received");
            return true;
        };
        if result.len() > 1 {
            tracing::warn!(
                request_id,
                count = result.len(),
                "unexpected number of app state recovery results"
            );
        }
        let snapshot = match parse_recovery(response) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                tracing::warn!(request_id, error = %error, "failed to parse app state recovery blob");
                return true;
            }
        };
        let name = WaPatchName::from(snapshot.collection_name.clone().unwrap_or_default());
        let version = snapshot
            .version
            .as_ref()
            .and_then(|version| version.version)
            .unwrap_or_default();
        let app_state = Arc::clone(&self.store.read().await.app_state);
        match app_state.get_app_state_version(name.as_str()).await {
            Err(error) => {
                tracing::error!(request_id, name = %name, error = %error, "failed to get current app state version");
                return true;
            }
            Ok((current_version, _)) if current_version >= version => {
                tracing::info!(
                    request_id,
                    name = %name,
                    current_version,
                    version,
                    "ignoring app state recovery response as current version is newer or equal"
                );
                return true;
            }
            Ok(_) => {}
        }
        tracing::debug!(request_id, "handling app state recovery response");
        let mutations = match self.app_state_processor().process_recovery(&snapshot).await {
            Ok(mutations) => mutations,
            Err(error) => {
                tracing::warn!(request_id, error = %error, "failed to parse app state recovery blob");
                return true;
            }
        };
        let mut events = Vec::new();
        let emit = self.config.emit_app_state_events_on_full_sync;
        if let Err(error) = self
            .collect_events_to_dispatch(&name, mutations, true, emit.then_some(&mut events))
            .await
        {
            tracing::warn!(request_id, error = %error, "failed to collect app state events");
            return true;
        }
        events.push(Event::AppStateSyncComplete(AppStateSyncComplete {
            name: name.clone(),
            version,
            recovery: true,
        }));
        for event in events {
            if self.dispatch_event(event).await {
                return false;
            }
        }
        tracing::debug!(request_id, name = %name, version, "finished handling app state recovery response");
        true
    }

    /// `applyAppStatePatches`: decodes the patches on top of `state` and
    /// collects their events. A missing key is requested from the phone in
    /// the background.
    async fn apply_app_state_patches(
        self: &Arc<Self>,
        name: &WaPatchName,
        state: HashState,
        patches: &PatchList,
        full_sync: bool,
        events: Option<&mut Vec<Event>>,
    ) -> Result<HashState, ClientError> {
        match self
            .app_state_processor()
            .decode_patches(patches, state, true)
            .await
        {
            Ok((mutations, new_state)) => {
                self.collect_events_to_dispatch(name, mutations, full_sync, events)
                    .await?;
                Ok(new_state)
            }
            Err(error) => {
                if error.sentinel() == Some(AppStateError::KeyNotFound) {
                    let client = Arc::clone(self);
                    let patches = patches.clone();
                    self.spawn(
                        async move { client.request_missing_app_state_keys(&patches).await },
                    );
                } else {
                    self.dispatch_event(Event::AppStateSyncError(AppStateSyncError {
                        name: name.clone(),
                        error: Arc::new(ClientError::Other(error.to_string())),
                        full_sync,
                    }))
                    .await;
                }
                Err(ClientError::from(error)
                    .wrap(format!("failed to decode app state {name} patches")))
            }
        }
    }

    /// `collectEventsToDispatch`: applies each mutation to the store and
    /// collects its events when `events` is given. A full sync of the
    /// contact list without events stores all contacts in one call.
    async fn collect_events_to_dispatch(
        &self,
        name: &WaPatchName,
        mut mutations: Vec<Mutation>,
        full_sync: bool,
        mut events: Option<&mut Vec<Event>>,
    ) -> Result<(), ClientError> {
        if *name == WA_PATCH_CRITICAL_UNBLOCK_LOW
            && full_sync
            && !self.config.emit_app_state_events_on_full_sync
        {
            let contacts;
            (mutations, contacts) = filter_contacts(mutations);
            tracing::debug!(
                count = contacts.len(),
                "mass inserting app state snapshot contacts into the store"
            );
            let contact_store = Arc::clone(&self.store.read().await.contacts);
            // A serious failure, so the whole sync is aborted.
            contact_store
                .put_all_contact_names(&contacts)
                .await
                .map_err(|error| {
                    ClientError::Other(format!(
                        "failed to update contact store with data from snapshot: {error}"
                    ))
                })?;
        }
        for mutation in mutations {
            if let Some(events) = &mut events
                && mutation.operation == SyncdOperation::Set as i32
            {
                events.push(Event::AppState(Box::new(AppState {
                    index: mutation.index.clone(),
                    sync_action_value: mutation.action.clone(),
                })));
            }
            let event = self.dispatch_app_state(name, &mutation, full_sync).await;
            if let (Some(events), Some(event)) = (&mut events, event) {
                events.push(event);
            }
        }
        Ok(())
    }

    /// `dispatchAppState`: applies one mutation's side effects to the store
    /// and returns its event. Where Go indexes past the end of a short index
    /// and panics, this returns `None`.
    async fn dispatch_app_state(
        &self,
        name: &WaPatchName,
        mutation: &Mutation,
        full_sync: bool,
    ) -> Option<Event> {
        let kind = mutation.index.first().map(String::as_str);
        tracing::trace!(
            patch_name = %name,
            patch_version = mutation.patch_version,
            operation = mutation.operation,
            version = mutation.version,
            kind,
            "received app state mutation"
        );
        let kind = kind?;
        let action = mutation.action.clone().unwrap_or_default();
        let set = mutation.operation == SyncdOperation::Set as i32;

        if mutation.index.len() == 1 && kind == INDEX_NCT_SALT_SYNC {
            let nct_salt = Arc::clone(&self.store.read().await.nct_salt);
            let result = if set {
                let salt = action
                    .nct_salt_sync_action
                    .and_then(|action| action.salt)
                    .unwrap_or_default();
                if salt.is_empty() {
                    Ok(())
                } else {
                    let result = nct_salt.put_nct_salt(salt).await;
                    if result.is_ok() {
                        tracing::debug!("stored new NCT salt");
                    }
                    result
                }
            } else if mutation.operation == SyncdOperation::Remove as i32 {
                tracing::debug!("clearing NCT salt");
                nct_salt.delete_nct_salt().await
            } else {
                Ok(())
            };
            if let Err(error) = result {
                tracing::warn!(error = %error, "failed to update NCT salt from app state mutation");
            }
            return None;
        }

        if !set {
            return None;
        }

        let jid = mutation
            .index
            .get(1)
            .map(|jid| parse_jid_or_empty(jid))
            .unwrap_or_default();
        let timestamp = unix_milli(action.timestamp.unwrap_or_default());
        let (contacts, chat_settings, msg_secrets) = {
            let store = self.store.read().await;
            (
                Arc::clone(&store.contacts),
                Arc::clone(&store.chat_settings),
                Arc::clone(&store.msg_secrets),
            )
        };

        let mut store_update_result = Ok(());
        let event = match kind {
            INDEX_MUTE => {
                let action = action.mute_action;
                let muted_until = action
                    .as_ref()
                    .filter(|action| action.muted.unwrap_or_default())
                    .map(|action| {
                        let end = action.mute_end_timestamp.unwrap_or_default();
                        if end < 0 {
                            *MUTED_FOREVER
                        } else {
                            unix_milli(end)
                        }
                    });
                store_update_result = chat_settings.put_muted_until(&jid, muted_until).await;
                Event::Mute(Box::new(Mute {
                    jid,
                    timestamp,
                    action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_PIN => {
                let action = action.pin_action;
                let pinned = action
                    .as_ref()
                    .and_then(|action| action.pinned)
                    .unwrap_or_default();
                store_update_result = chat_settings.put_pinned(&jid, pinned).await;
                Event::Pin(Box::new(Pin {
                    jid,
                    timestamp,
                    action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_ARCHIVE => {
                let action = action.archive_chat_action;
                let archived = action
                    .as_ref()
                    .and_then(|action| action.archived)
                    .unwrap_or_default();
                store_update_result = chat_settings.put_archived(&jid, archived).await;
                Event::Archive(Box::new(Archive {
                    jid,
                    timestamp,
                    action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_CONTACT => {
                let action = action.contact_action;
                let (first_name, full_name) = action.as_ref().map_or((None, None), |action| {
                    (action.first_name.as_deref(), action.full_name.as_deref())
                });
                // Go passes (first, full) to an interface declared (full,
                // first) whose SQL implementation takes (first, full).
                store_update_result = contacts
                    .put_contact_name(
                        &jid,
                        full_name.unwrap_or_default(),
                        first_name.unwrap_or_default(),
                    )
                    .await;
                Event::Contact(Box::new(Contact {
                    jid,
                    timestamp,
                    action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_CLEAR_CHAT => Event::ClearChat(Box::new(ClearChat {
                jid,
                timestamp,
                action: action.clear_chat_action,
                from_full_sync: full_sync,
                // Go doesn't know what index 2 is either.
                delete_media: mutation.index.get(3).is_some_and(|value| value == "1"),
            })),
            INDEX_DELETE_CHAT => Event::DeleteChat(Box::new(DeleteChat {
                jid,
                timestamp,
                action: action.delete_chat_action,
                from_full_sync: full_sync,
                delete_media: mutation.index.get(2).is_some_and(|value| value == "1"),
            })),
            INDEX_STAR => {
                let [_, _, message_id, from_me, sender, ..] = mutation.index.as_slice() else {
                    return None;
                };
                Event::Star(Box::new(Star {
                    chat_jid: jid,
                    sender_jid: sender_of(sender),
                    is_from_me: from_me == "1",
                    message_id: message_id.clone(),
                    timestamp,
                    action: action.star_action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_DELETE_MESSAGE_FOR_ME => {
                let [_, _, message_id, from_me, sender, ..] = mutation.index.as_slice() else {
                    return None;
                };
                Event::DeleteForMe(Box::new(DeleteForMe {
                    chat_jid: jid,
                    sender_jid: sender_of(sender),
                    is_from_me: from_me == "1",
                    message_id: message_id.clone(),
                    timestamp,
                    action: action.delete_message_for_me_action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_MARK_CHAT_AS_READ => Event::MarkChatAsRead(Box::new(MarkChatAsRead {
                jid,
                timestamp,
                action: action.mark_chat_as_read_action,
                from_full_sync: full_sync,
            })),
            INDEX_SETTING_PUSH_NAME => {
                let action = action.push_name_setting;
                let mut store = self.store.write().await;
                store.push_name = action
                    .as_ref()
                    .and_then(|action| action.name.clone())
                    .unwrap_or_default();
                if let Err(error) = store.save().await {
                    tracing::error!(error = %error, "failed to save device store after updating push name");
                }
                Event::PushNameSetting(Box::new(PushNameSetting {
                    timestamp,
                    action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_SETTING_UNARCHIVE_CHATS => {
                Event::UnarchiveChatsSetting(Box::new(UnarchiveChatsSetting {
                    timestamp,
                    action: action.unarchive_chats_setting,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_USER_STATUS_MUTE => Event::UserStatusMute(Box::new(UserStatusMute {
                jid,
                timestamp,
                action: action.user_status_mute_action,
                from_full_sync: full_sync,
            })),
            INDEX_LABEL_EDIT => Event::LabelEdit(Box::new(LabelEdit {
                timestamp,
                label_id: mutation.index.get(1)?.clone(),
                action: action.label_edit_action,
                from_full_sync: full_sync,
            })),
            INDEX_LABEL_ASSOCIATION_CHAT => {
                let [_, label_id, chat, ..] = mutation.index.as_slice() else {
                    return None;
                };
                Event::LabelAssociationChat(Box::new(LabelAssociationChat {
                    jid: parse_jid_or_empty(chat),
                    timestamp,
                    label_id: label_id.clone(),
                    action: action.label_association_action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_LABEL_ASSOCIATION_MESSAGE => {
                let [_, label_id, chat, message_id, _, _, ..] = mutation.index.as_slice() else {
                    return None;
                };
                Event::LabelAssociationMessage(Box::new(LabelAssociationMessage {
                    jid: parse_jid_or_empty(chat),
                    timestamp,
                    label_id: label_id.clone(),
                    message_id: message_id.clone(),
                    action: action.label_association_action,
                    from_full_sync: full_sync,
                }))
            }
            INDEX_WASA_ROOT_SECRET_ACTION => {
                let bot_jid = mutation.index.get(1).map(|jid| parse_jid_or_empty(jid))?;
                let own_lid = self.get_own_lid().await;
                let secrets = action
                    .wasa_root_secret_action
                    .map(|action| action.secrets)
                    .unwrap_or_default();
                let inserts: Vec<MessageSecretInsert> = secrets
                    .iter()
                    .map(|secret| MessageSecretInsert {
                        chat: bot_jid.clone(),
                        sender: own_lid.clone(),
                        id: secret.id.clone().unwrap_or_default(),
                        secret: secret.root_secret.clone().unwrap_or_default(),
                    })
                    .collect();
                store_update_result = msg_secrets.put_message_secrets(&inserts).await;
                if store_update_result.is_ok() {
                    let mut active: Option<&RootSecretEntry> = None;
                    for secret in &secrets {
                        if secret.status == Some(RootSecretStatus::Active as i32)
                            && active.is_none_or(|current| {
                                secret.epoch.unwrap_or_default() > current.epoch.unwrap_or_default()
                            })
                        {
                            active = Some(secret);
                        }
                    }
                    let active_id = active
                        .and_then(|active| active.id.clone())
                        .unwrap_or_default();
                    store_update_result = chat_settings
                        .put_wasa_root_secret_id(&bot_jid, &active_id)
                        .await;
                }
                if store_update_result.is_ok() {
                    tracing::debug!(
                        count = inserts.len(),
                        "stored WASA root secrets from app state"
                    );
                }
                if let Err(error) = store_update_result {
                    tracing::error!(error = %error, "failed to update device store after app state mutation");
                }
                return None;
            }
            _ => return None,
        };
        if let Err(error) = store_update_result {
            tracing::error!(error = %error, "failed to update device store after app state mutation");
        }
        Some(event)
    }

    /// `fetchAppStatePatches`: asks the server for the collection's patches
    /// after `from_version`, or for a snapshot.
    async fn fetch_app_state_patches(
        &self,
        name: &WaPatchName,
        from_version: u64,
        snapshot: bool,
    ) -> Result<PatchList, ClientError> {
        let mut attrs = Attrs::from([
            ("name".to_owned(), name.as_str().into()),
            ("return_snapshot".to_owned(), snapshot.into()),
        ]);
        if !snapshot {
            attrs.insert("version".to_owned(), from_version.into());
        }
        let response = self
            .send_iq(InfoQuery {
                namespace: "w:sync:app:state",
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "sync".to_owned(),
                    attrs: Attrs::new(),
                    content: Some(NodeContent::Nodes(vec![Node {
                        tag: "collection".to_owned(),
                        attrs,
                        content: None,
                    }])),
                }])),
                ..Default::default()
            })
            .await?;
        let collection = response
            .get_optional_child_by_tag(&["sync", "collection"])
            .ok_or_else(|| element_missing("collection", "app state patch response"))?;
        Ok(parse_patch_list(collection, Some(self as &dyn DownloadExternal)).await?)
    }

    /// `requestMissingAppStateKeys`: asks the phone for the keys the patches
    /// need, at most once a day per key.
    async fn request_missing_app_state_keys(self: &Arc<Self>, patches: &PatchList) {
        let raw_key_ids = self
            .app_state_processor()
            .get_missing_key_ids(patches)
            .await;
        let now = tokio::time::Instant::now();
        let filtered_key_ids = {
            let mut requests = lock(&self.app_state_key_requests);
            raw_key_ids
                .into_iter()
                .filter(|key_id| {
                    let string_key_id = hex::encode(key_id);
                    let due = requests
                        .get(&string_key_id)
                        .is_none_or(|last_request| *last_request + KEY_REQUEST_INTERVAL < now);
                    if due {
                        requests.insert(string_key_id, now);
                    }
                    due
                })
                .collect::<Vec<_>>()
        };
        self.request_app_state_keys(&filtered_key_ids).await;
    }

    /// `requestAppStateKeys`: sends the phone a key request for the keys.
    async fn request_app_state_keys(self: &Arc<Self>, raw_key_ids: &[Vec<u8>]) {
        if raw_key_ids.is_empty() {
            return;
        }
        let key_ids: Vec<String> = raw_key_ids.iter().map(hex::encode).collect();
        tracing::info!(key_ids = ?key_ids, "sending key request for app state keys");
        if let Err(error) = self
            .send_peer_message(build_app_state_key_request(raw_key_ids))
            .await
        {
            tracing::warn!(error = %error, "failed to send app state key request");
        }
    }

    /// Sends an app state patch, then resyncs that collection to update the
    /// local state and dispatch the events of the change. Build the patch
    /// with the `build_*` functions of [`crate::appstate`], e.g.
    /// [`build_mute`](crate::appstate::build_mute).
    #[tracing::instrument(
        name = "whatsmeow.app_state.send",
        skip_all,
        fields(name = %patch.patch_type),
        err
    )]
    pub async fn send_app_state(self: &Arc<Self>, patch: PatchInfo) -> Result<(), ClientError> {
        self.send_app_state_inner(patch, true).await
    }

    /// Boxed because a conflict retries once by recursing.
    fn send_app_state_inner(
        self: &Arc<Self>,
        patch: PatchInfo,
        allow_retry: bool,
    ) -> BoxFuture<'_, Result<(), ClientError>> {
        Box::pin(async move {
            let (app_state, app_state_keys) = {
                let store = self.store.read().await;
                (
                    Arc::clone(&store.app_state),
                    Arc::clone(&store.app_state_keys),
                )
            };
            let (version, hash) = app_state
                .get_app_state_version(patch.patch_type.as_str())
                .await?;
            // Go: TODO create new key instead of reusing the primary
            // client's keys.
            let latest_key_id = app_state_keys
                .get_latest_app_state_sync_key_id()
                .await
                .map_err(|error| {
                    ClientError::from(error).wrap("failed to get latest app state key ID")
                })?
                .ok_or_else(|| {
                    ClientError::Other(
                        "no app state keys found, creating app state keys is not yet supported"
                            .to_owned(),
                    )
                })?;
            let state = HashState { version, hash };
            let encoded_patch = self
                .app_state_processor()
                .encode_patch(&latest_key_id, state, patch.clone())
                .await?;

            let response = self
                .send_iq(InfoQuery {
                    namespace: "w:sync:app:state",
                    r#type: IqType::Set,
                    to: SERVER_JID.clone(),
                    content: Some(NodeContent::Nodes(vec![Node {
                        tag: "sync".to_owned(),
                        attrs: Attrs::new(),
                        content: Some(NodeContent::Nodes(vec![Node {
                            tag: "collection".to_owned(),
                            attrs: Attrs::from([
                                ("name".to_owned(), patch.patch_type.as_str().into()),
                                ("version".to_owned(), version.into()),
                                ("return_snapshot".to_owned(), false.into()),
                            ]),
                            content: Some(NodeContent::Nodes(vec![Node {
                                tag: "patch".to_owned(),
                                attrs: Attrs::new(),
                                content: Some(NodeContent::Bytes(encoded_patch)),
                            }])),
                        }])),
                    }])),
                    ..Default::default()
                })
                .await?;

            let collection = response
                .get_optional_child_by_tag(&["sync", "collection"])
                .ok_or_else(|| element_missing("collection", "app state send response"))?;
            if collection.attr_getter().optional_string("type") == "error" {
                let error_tag = collection.get_optional_child_by_tag(&["error"]);
                let main_error = match error_tag {
                    Some(error_tag) => ClientError::AppStateUpdate
                        .wrap(format!("{} {error_tag}", patch.patch_type)),
                    None => ClientError::AppStateUpdate.wrap(collection.to_string()),
                };
                if let Some(error_tag) = error_tag
                    && error_tag.attr_getter().int("code") == 409
                    && allow_retry
                {
                    tracing::warn!(error = %main_error, "failed to update app state, trying to apply conflicts and retry");
                    let patches =
                        parse_patch_list(collection, Some(self.as_ref() as &dyn DownloadExternal))
                            .await
                            .map_err(|error| {
                                main_error.wrap(format!(
                                    "also, parsing patches in the response failed: {error}"
                                ))
                            })?;
                    let mut events = Vec::new();
                    if let Err(error) = self
                        .apply_app_state_patches(
                            &patch.patch_type,
                            state,
                            &patches,
                            false,
                            Some(&mut events),
                        )
                        .await
                    {
                        return Err(ClientError::AppStateUpdate.wrap(format!(
                            "{} (also, applying patches in the response failed: {error})",
                            patch.patch_type
                        )));
                    }
                    tracing::debug!("retrying app state send after applying conflicting patches");
                    self.spawn_dispatch_all(events);
                    return self.send_app_state_inner(patch, false).await;
                }
                return Err(main_error);
            }
            let events = self
                .fetch_app_state_events(&patch.patch_type, false, false)
                .await
                .map_err(|error| error.wrap("failed to fetch app state after sending update"))?;
            self.spawn_dispatch_all(events);
            Ok(())
        })
    }

    /// Dispatches the events in order in the background (Go's goroutine
    /// looping over `dispatchEvent`).
    fn spawn_dispatch_all(self: &Arc<Self>, events: Vec<Event>) {
        let client = Arc::clone(self);
        self.spawn(async move {
            for event in events {
                client.dispatch_event(event).await;
            }
        });
    }

    /// Tells the server that a dirty bit of the given type is clean.
    pub async fn mark_not_dirty(
        &self,
        clean_type: &str,
        timestamp: DateTime<Utc>,
    ) -> Result<(), ClientError> {
        self.send_iq(InfoQuery {
            namespace: "urn:xmpp:whatsapp:dirty",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "clean".to_owned(),
                attrs: Attrs::from([
                    ("type".to_owned(), clean_type.into()),
                    ("timestamp".to_owned(), timestamp.timestamp().into()),
                ]),
                content: None,
            }])),
            ..Default::default()
        })
        .await
        .map(|_| ())
    }

    /// Stores the app state keys the phone shared, then fetches every
    /// collection: all of them when a key answers one of our requests,
    /// otherwise only the ones never synced (`handleAppStateSyncKeyShare` in
    /// Go's `message.go`). The message receive path calls this for a
    /// protocol message's `app_state_sync_key_share`.
    pub(crate) async fn handle_app_state_sync_key_share(
        self: &Arc<Self>,
        keys: &AppStateSyncKeyShare,
    ) {
        let mut only_resync_if_not_synced = true;
        tracing::debug!(count = keys.keys.len(), "got new app state keys");
        let app_state_keys = Arc::clone(&self.store.read().await.app_state_keys);
        for key in &keys.keys {
            let key_id = key
                .key_id
                .as_ref()
                .and_then(|key_id| key_id.key_id.clone())
                .unwrap_or_default();
            let key_data = key.key_data.clone().unwrap_or_default();
            let fingerprint = key_data
                .fingerprint
                .as_ref()
                .map(prost::Message::encode_to_vec)
                .unwrap_or_default();
            if lock(&self.app_state_key_requests).contains_key(&hex::encode(&key_id)) {
                only_resync_if_not_synced = false;
            }
            let timestamp = key_data.timestamp.unwrap_or_default();
            if let Err(error) = app_state_keys
                .put_app_state_sync_key(
                    &key_id,
                    AppStateSyncKey {
                        data: key_data.key_data.unwrap_or_default(),
                        fingerprint,
                        timestamp,
                    },
                )
                .await
            {
                tracing::error!(key_id = %hex::encode_upper(&key_id), error = %error, "failed to store app state sync key");
                continue;
            }
            tracing::debug!(key_id = %hex::encode_upper(&key_id), timestamp, "received app state sync key");
        }

        for name in &ALL_PATCH_NAMES {
            if let Err(error) = self
                .fetch_app_state(name, false, only_resync_if_not_synced)
                .await
            {
                tracing::error!(name = %name, error = %error, "failed to do initial fetch of app state");
            }
        }
    }

    /// `handleAppStateNotification`: a `server_sync` notification lists the
    /// collections that changed; fetch each, stopping when disconnected.
    pub(crate) async fn handle_app_state_notification(self: &Arc<Self>, node: &Node) {
        for collection in node.get_children_by_tag("collection") {
            let mut attrs = collection.attr_getter();
            let name = WaPatchName::from(attrs.string("name"));
            let version = attrs.uint64("version");
            tracing::debug!(name = %name, version, "got server sync notification that app state was updated");
            match self.fetch_app_state(&name, false, false).await {
                Err(error)
                    if error.is(&DisconnectedError::iq().into())
                        || error.is(&ClientError::NotConnected) =>
                {
                    // There are some app state changes right before a remote
                    // logout, so stop syncing when disconnected.
                    tracing::debug!(error = %error, "failed to sync app state after notification, not trying to sync other states");
                    return;
                }
                Err(error) => {
                    tracing::error!(error = %error, "failed to sync app state after notification");
                }
                Ok(()) => {}
            }
        }
    }
}

/// Go's `SenderJID` for stars and deletes: empty when the index says `0`.
fn sender_of(sender: &str) -> Jid {
    if sender == "0" {
        Jid::default()
    } else {
        parse_jid_or_empty(sender)
    }
}

/// `filterContacts`: splits contact mutations off as store entries.
fn filter_contacts(mutations: Vec<Mutation>) -> (Vec<Mutation>, Vec<ContactEntry>) {
    let mut filtered_mutations = Vec::with_capacity(mutations.len());
    let mut contacts = Vec::with_capacity(mutations.len());
    for mutation in mutations {
        match mutation.index.as_slice() {
            [kind, jid, ..] if kind == INDEX_CONTACT => {
                let action = mutation
                    .action
                    .as_ref()
                    .and_then(|action| action.contact_action.as_ref());
                contacts.push(ContactEntry {
                    jid: parse_jid_or_empty(jid),
                    first_name: action
                        .and_then(|action| action.first_name.clone())
                        .unwrap_or_default(),
                    full_name: action
                        .and_then(|action| action.full_name.clone())
                        .unwrap_or_default(),
                });
            }
            _ => filtered_mutations.push(mutation),
        }
    }
    (filtered_mutations, contacts)
}

/// The protocol message asking the phone for app state keys (built in Go's
/// `requestAppStateKeys`).
pub(crate) fn build_app_state_key_request(raw_key_ids: &[Vec<u8>]) -> wa_e2e::Message {
    wa_e2e::Message {
        protocol_message: Some(Box::new(ProtocolMessage {
            r#type: Some(protocol_message::Type::AppStateSyncKeyRequest as i32),
            app_state_sync_key_request: Some(AppStateSyncKeyRequest {
                key_i_ds: raw_key_ids
                    .iter()
                    .map(|key_id| AppStateSyncKeyId {
                        key_id: Some(key_id.clone()),
                    })
                    .collect(),
            }),
            ..ProtocolMessage::default()
        })),
        ..wa_e2e::Message::default()
    }
}

/// Builds a message asking the user's primary device to reset the given app
/// state collections, which logs out every linked device. Send it with the
/// client's peer message sending; there is no response.
pub fn build_fatal_app_state_exception_notification(
    collections: &[WaPatchName],
) -> wa_e2e::Message {
    wa_e2e::Message {
        protocol_message: Some(Box::new(ProtocolMessage {
            r#type: Some(protocol_message::Type::AppStateFatalExceptionNotification as i32),
            app_state_fatal_exception_notification: Some(AppStateFatalExceptionNotification {
                collection_names: collections
                    .iter()
                    .map(|collection| collection.as_str().to_owned())
                    .collect(),
                timestamp: Some(Utc::now().timestamp_millis()),
            }),
            ..ProtocolMessage::default()
        })),
        ..wa_e2e::Message::default()
    }
}

/// Builds a message asking the user's primary device for an unencrypted copy
/// of the collection. The response comes as a protocol message of type
/// `PEER_DATA_OPERATION_RESPONSE_MESSAGE`.
pub fn build_app_state_recovery_request(collection: &WaPatchName) -> wa_e2e::Message {
    wa_e2e::Message {
        protocol_message: Some(Box::new(ProtocolMessage {
            r#type: Some(protocol_message::Type::PeerDataOperationRequestMessage as i32),
            peer_data_operation_request_message: Some(PeerDataOperationRequestMessage {
                peer_data_operation_request_type: Some(
                    PeerDataOperationRequestType::CompanionSyncdSnapshotFatalRecovery as i32,
                ),
                syncd_collection_fatal_recovery_request: Some(
                    SyncDCollectionFatalRecoveryRequest {
                        collection_name: Some(collection.as_str().to_owned()),
                        timestamp: Some(Utc::now().timestamp()),
                    },
                ),
                ..PeerDataOperationRequestMessage::default()
            }),
            ..ProtocolMessage::default()
        })),
        ..wa_e2e::Message::default()
    }
}

#[cfg(test)]
mod test;
