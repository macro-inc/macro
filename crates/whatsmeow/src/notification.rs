// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow notification.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: the newsletter, mex and FB device list notifications (features
// the port skips).

//! Handling of `<notification>` nodes.

use std::sync::Arc;

use crate::binary::{Node, NodeContent};
use crate::client::Client;
use crate::group::GroupNotification;
use crate::send::participant_list_hash_v2;
use crate::store::PrivacyToken;
use crate::types::events::{
    Blocklist, BlocklistAction, BlocklistChange, BlocklistChangeAction, Event, IdentityChange,
    Picture, UserAbout,
};
use crate::types::{Jid, SERVER_JID};

impl Client {
    async fn handle_encrypt_notification(self: &Arc<Self>, node: &Node) {
        let from = node.attr_getter().jid("from");
        if from == *SERVER_JID {
            let count = node.get_child_by_tag(&["count"]);
            let mut attrs = count.attr_getter();
            let otks_left = attrs.int("value");
            if !attrs.ok() {
                tracing::warn!("didn't get number of OTKs left in encryption notification");
                return;
            }
            tracing::info!(otks_left, "got prekey count from server");
            if otks_left < crate::prekeys::MIN_PRE_KEY_COUNT as i64 {
                self.upload_pre_keys(false).await;
            }
        } else if node.get_optional_child_by_tag(&["identity"]).is_some() {
            tracing::debug!(
                "got identity change, deleting all identities/sessions for that number"
            );
            let (identities, sessions, privacy_tokens) = {
                let store = self.store.read().await;
                (
                    Arc::clone(&store.identities),
                    Arc::clone(&store.sessions),
                    Arc::clone(&store.privacy_tokens),
                )
            };
            if let Err(error) = identities.delete_all_identities(&from.user).await {
                tracing::warn!(error = %error, "failed to delete all identities from store after identity change");
            }
            if let Err(error) = sessions.delete_all_sessions(&from.user).await {
                tracing::warn!(error = %error, "failed to delete all sessions from store after identity change");
            }
            let timestamp = node.attr_getter().unix_time("t");
            let storage_lid = self.resolve_tc_token_storage_lid(&from).await;
            let stored_sender_timestamp = match privacy_tokens.get_privacy_token(&storage_lid).await
            {
                Ok(token) => token.and_then(|token| token.sender_timestamp),
                Err(error) => {
                    tracing::debug!(error = %error, "failed to load tctoken for identity change re-issue");
                    None
                }
            };
            if self.validate_and_set_tc_token_sender_ts(&storage_lid, stored_sender_timestamp)
                && let Some(sender_timestamp) = self.get_tc_token_sender_ts(&storage_lid)
            {
                tracing::debug!("identity changed, re-issuing tctoken");
                let client = Arc::clone(self);
                self.spawn(async move {
                    client
                        .issue_privacy_token_and_save(storage_lid, sender_timestamp)
                        .await;
                });
            }
            self.dispatch_event(Event::IdentityChange(IdentityChange {
                jid: from,
                timestamp,
                implicit: false,
            }))
            .await;
        } else {
            tracing::debug!("got unknown encryption notification from server");
        }
    }

    async fn handle_picture_notification(&self, node: &Node) {
        let timestamp = node.attr_getter().unix_time("t");
        for child in node.get_children() {
            let mut attrs = child.attr_getter();
            let mut event = Picture {
                timestamp,
                jid: attrs.jid("jid"),
                author: attrs.optional_jid_or_empty("author"),
                ..Picture::default()
            };
            match child.tag.as_str() {
                "delete" => event.remove = true,
                // Sometimes there's a hash and no ID on "set".
                "add" | "set" => event.picture_id = attrs.string("id"),
                _ => continue,
            }
            if !attrs.ok() {
                tracing::debug!(error = ?attrs.error().err(), "ignoring picture change notification with unexpected attributes");
                continue;
            }
            self.dispatch_event(Event::Picture(event)).await;
        }
    }

    async fn handle_device_notification(&self, node: &Node) {
        let mut cache = self.user_devices_cache.lock().await;
        let mut attrs = node.attr_getter();
        let from = attrs.jid("from");
        let from_lid = attrs.optional_jid("lid");
        if let Some(from_lid) = &from_lid {
            self.store_lid_pn_mapping(from_lid, &from).await;
        }
        let Some(mut cached) = cache.get(&from).cloned() else {
            tracing::debug!("no device list cached, ignoring device list notification");
            return;
        };
        let mut cached_lid = from_lid
            .as_ref()
            .and_then(|lid| cache.get(lid).cloned())
            .unwrap_or_default();
        for child in node.get_children() {
            let mut child_attrs = child.attr_getter();
            let device_hash = child_attrs.string("device_hash");
            let device_lid_hash = child_attrs.optional_string("device_lid_hash");
            let device_child = child.get_child_by_tag(&["device"]);
            let mut device_attrs = device_child.attr_getter();
            let changed_device_jid = device_attrs.jid("jid");
            let changed_device_lid = device_attrs.optional_jid("lid");
            match child.tag.as_str() {
                "add" => {
                    cached.devices.push(changed_device_jid);
                    if let Some(lid) = &changed_device_lid {
                        cached_lid.devices.push(lid.clone());
                    }
                }
                "remove" => {
                    cached
                        .devices
                        .retain(|existing| *existing != changed_device_jid);
                    if let Some(lid) = &changed_device_lid {
                        cached_lid.devices.retain(|existing| existing != lid);
                    }
                }
                "update" => {
                    // The exact meaning of "update" is unknown; clear the
                    // device list cache to be safe.
                    tracing::debug!("device list updated, dropping cached devices");
                    cache.remove(&from);
                    continue;
                }
                other => {
                    tracing::debug!(tag = other, "unknown device list change tag");
                    continue;
                }
            }
            if participant_list_hash_v2(&cached.devices) == device_hash {
                tracing::debug!(tag = %child.tag, "device list hash changed, new hash matches");
                cache.insert(from.clone(), cached.clone());
            } else {
                tracing::warn!(tag = %child.tag, "device list hash changed, new hash doesn't match");
                cache.remove(&from);
            }
            if let (Some(from_lid), Some(_)) = (&from_lid, &changed_device_lid)
                && !device_lid_hash.is_empty()
            {
                if participant_list_hash_v2(&cached_lid.devices) == device_lid_hash {
                    tracing::debug!(tag = %child.tag, "LID device list hash changed, new hash matches");
                    cache.insert(from_lid.clone(), cached_lid.clone());
                } else {
                    tracing::warn!(tag = %child.tag, "LID device list hash changed, new hash doesn't match");
                    cache.remove(from_lid);
                }
            }
        }
    }

    async fn handle_own_devices_notification(&self, node: &Node, from_jid: &Jid) {
        let mut cache = self.user_devices_cache.lock().await;
        let own_lid = self.get_own_lid().await.to_non_ad();
        let own_id = self.get_own_id().await.to_non_ad();
        if own_id.is_empty() {
            tracing::debug!("ignoring own device change notification, session was deleted");
            return;
        }
        let from_jid_plain = from_jid.to_non_ad();
        let alt_jid = if from_jid_plain == own_id {
            own_lid.clone()
        } else if from_jid_plain == own_lid {
            own_id.clone()
        } else {
            tracing::warn!("unexpected own device notification sender");
            return;
        };
        let expected_new_hash = node.attr_getter().string("dhash");
        let mut new_device_list = Vec::new();
        let mut alt_device_list = Vec::new();
        for child in node.get_children() {
            let jid = child.attr_getter().jid("jid");
            if child.tag == "device" && !jid.is_empty() {
                let mut alt_device_jid = alt_jid.clone();
                alt_device_jid.device = jid.device;
                new_device_list.push(jid);
                alt_device_list.push(alt_device_jid);
            }
        }
        let new_hash = participant_list_hash_v2(&new_device_list);
        if new_hash != expected_new_hash {
            tracing::debug!(
                "received own device list change notification, but the hash didn't match"
            );
            cache.remove(&own_id);
            cache.remove(&own_lid);
        } else {
            tracing::debug!("received own device list change notification");
            let alt_hash = participant_list_hash_v2(&alt_device_list);
            cache.insert(
                from_jid_plain,
                crate::client::DeviceCache {
                    devices: new_device_list,
                    dhash: expected_new_hash,
                },
            );
            cache.insert(
                alt_jid,
                crate::client::DeviceCache {
                    devices: alt_device_list,
                    dhash: alt_hash,
                },
            );
        }
    }

    async fn handle_blocklist(&self, node: &Node) {
        let mut attrs = node.attr_getter();
        let mut event = Blocklist {
            action: BlocklistAction::from(attrs.optional_string("action")),
            d_hash: attrs.string("dhash"),
            prev_d_hash: attrs.optional_string("prev_dhash"),
            changes: Vec::new(),
        };
        for child in node.get_children() {
            let mut child_attrs = child.attr_getter();
            let change = BlocklistChange {
                jid: child_attrs.jid("jid"),
                action: BlocklistChangeAction::from(child_attrs.string("action")),
            };
            if !child_attrs.ok() {
                tracing::warn!("unexpected data in blocklist event child");
                continue;
            }
            event.changes.push(change);
        }
        self.dispatch_event(Event::Blocklist(event)).await;
    }

    async fn handle_account_sync_notification(self: &Arc<Self>, node: &Node) {
        for child in node.get_children() {
            match child.tag.as_str() {
                "privacy" => self.handle_privacy_settings_notification(child).await,
                "devices" => {
                    let from = node.attr_getter().jid("from");
                    self.handle_own_devices_notification(child, &from).await;
                }
                "picture" => {
                    let event = Picture {
                        timestamp: node.attr_getter().unix_time("t"),
                        jid: self.get_own_id().await.to_non_ad(),
                        ..Picture::default()
                    };
                    self.dispatch_event(Event::Picture(event)).await;
                }
                "blocklist" => self.handle_blocklist(child).await,
                other => tracing::debug!(tag = other, "unhandled account sync item"),
            }
        }
    }

    async fn handle_privacy_token_notification(&self, node: &Node) {
        if self.get_own_id().await.is_empty() {
            tracing::debug!("ignoring privacy token notification, session was deleted");
            return;
        }
        let tokens = node.get_child_by_tag(&["tokens"]);
        if tokens.tag != "tokens" {
            tracing::warn!("privacy_token notification didn't contain <tokens> tag");
            return;
        }
        let mut parent_attrs = node.attr_getter();
        let sender = parent_attrs.jid("from").to_non_ad();
        let mut sender_lid = parent_attrs.optional_jid_or_empty("sender_lid").to_non_ad();
        if !parent_attrs.ok() {
            tracing::warn!("privacy_token notification didn't have a sender");
            return;
        }
        if sender_lid.is_empty() {
            sender_lid = self.resolve_tc_token_storage_lid(&sender).await;
        }
        let privacy_tokens = Arc::clone(&self.store.read().await.privacy_tokens);
        for child in tokens.get_children() {
            let mut attrs = child.attr_getter();
            if child.tag != "token" {
                tracing::warn!(tag = %child.tag, "privacy_token notification contained unexpected tag");
                continue;
            }
            let token_type = attrs.string("type");
            if token_type != "trusted_contact" {
                tracing::warn!(token_type = %token_type, "privacy_token notification contained unexpected token type");
                continue;
            }
            let Some(NodeContent::Bytes(token)) = &child.content else {
                tracing::warn!("privacy_token notification contained non-binary token");
                continue;
            };
            let timestamp = attrs.unix_time("t");
            if !attrs.ok() {
                tracing::warn!("privacy_token notification is missing some fields");
            }
            let result = privacy_tokens
                .put_privacy_tokens(&[PrivacyToken {
                    user: sender_lid.clone(),
                    token: token.clone(),
                    timestamp: timestamp.unwrap_or_default(),
                    sender_timestamp: None,
                }])
                .await;
            match result {
                Err(error) => tracing::error!(error = %error, "failed to save privacy token"),
                Ok(()) => tracing::debug!("received privacy token"),
            }
        }
    }

    async fn handle_status_notification(&self, node: &Node) {
        let mut attrs = node.attr_getter();
        let Some(child) = node.get_optional_child_by_tag(&["set"]) else {
            tracing::debug!("status notification did not contain child with tag 'set'");
            return;
        };
        let Some(NodeContent::Bytes(status)) = &child.content else {
            tracing::warn!("set status notification has unexpected content");
            return;
        };
        let event = UserAbout {
            jid: attrs.jid("from"),
            timestamp: attrs.unix_time("t"),
            status: String::from_utf8_lossy(status).into_owned(),
        };
        self.dispatch_event(Event::UserAbout(event)).await;
    }

    /// Emits the group event of a `w:gp2` notification after storing the
    /// LID mappings and redacted phones it carries; returns whether a
    /// handler failed (so the notification isn't acked).
    async fn handle_group_notification(&self, node: &Node) -> bool {
        let (event, lid_pairs, redacted_phones) = match self.parse_group_notification(node).await {
            Ok(parsed) => parsed,
            Err(error) => {
                tracing::error!(error = %error, "failed to parse group notification");
                return false;
            }
        };
        let (lids, contacts) = {
            let store = self.store.read().await;
            (Arc::clone(&store.lids), Arc::clone(&store.contacts))
        };
        if let Err(error) = lids.put_many_lid_mappings(&lid_pairs).await {
            tracing::error!(error = %error, "failed to store LID mappings from group notification");
        }
        if let Err(error) = contacts.put_many_redacted_phones(&redacted_phones).await {
            tracing::warn!(error = %error, "failed to store redacted phones from group notification");
        }
        self.dispatch_event(match event {
            GroupNotification::Joined(joined) => Event::JoinedGroup(joined),
            GroupNotification::Change(change) => Event::GroupInfo(change),
        })
        .await
    }

    pub(crate) async fn handle_notification(self: &Arc<Self>, node: &Node) {
        let mut cancelled = false;
        let ack = self.maybe_deferred_ack(node);
        let mut attrs = node.attr_getter();
        let notification_type = attrs.string("type");
        if attrs.ok() {
            match notification_type.as_str() {
                "encrypt" => {
                    let client = Arc::clone(self);
                    let node = node.clone();
                    self.spawn(async move { client.handle_encrypt_notification(&node).await });
                }
                "server_sync" => {
                    let client = Arc::clone(self);
                    let node = node.clone();
                    self.spawn(async move { client.handle_app_state_notification(&node).await });
                }
                "account_sync" => {
                    let client = Arc::clone(self);
                    let node = node.clone();
                    self.spawn(async move { client.handle_account_sync_notification(&node).await });
                }
                "devices" => self.handle_device_notification(node).await,
                "w:gp2" => cancelled = self.handle_group_notification(node).await,
                "picture" => self.handle_picture_notification(node).await,
                "privacy_token" => self.handle_privacy_token_notification(node).await,
                "status" => self.handle_status_notification(node).await,
                "mediaretry" => self.handle_media_retry_notification(node).await,
                "link_code_companion_reg" => {
                    let client = Arc::clone(self);
                    self.spawn(client.try_handle_code_pair_notification(node.clone()));
                }
                "passkey_prologue_request" => self.handle_passkey_notification(node).await,
                "crsc_continuation" => {
                    let client = Arc::clone(self);
                    self.spawn(client.try_handle_passkey_continuation_notification(node.clone()));
                }
                "companion_reg_refresh" => {
                    let refresh = node
                        .get_optional_child_by_tag(&["companion_reg_refresh"])
                        .is_some();
                    let rotate_qr = node
                        .get_optional_child_by_tag(&["pair-device-rotate-qr"])
                        .is_some();
                    if refresh || rotate_qr {
                        self.rotate_adv_secret().await;
                    } else {
                        tracing::debug!("unrecognized companion reg refresh notification");
                    }
                }
                // Other types: business, disappearing_mode, server, pay, psa,
                // and the ones the port skips.
                other => tracing::debug!(notification_type = other, "unhandled notification"),
            }
        }
        self.finish_deferred_ack(ack, cancelled).await;
    }
}
