// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow connectionevents.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: the Messenger crypto auth token refresh branches (`RefreshCAT`).

//! Handling of the connection lifecycle nodes: `success`, `failure`,
//! `stream:error` and `ib`.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use chrono::Utc;

use crate::binary::{Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::prekeys::MIN_PRE_KEY_COUNT;
use crate::request::{InfoQuery, IqType};
use crate::store::get_wa_version;
use crate::types::events::{
    ClientOutdated, ConnectFailure, ConnectFailureReason, Connected, Event, LoggedOut,
    ManualLoginReconnect, OfflineSyncCompleted, OfflineSyncPreview, QrScannedWithoutMultidevice,
    StreamError, StreamReplaced, TempBanReason, TemporaryBan,
};
use crate::types::{Jid, SERVER_JID};

impl Client {
    pub(crate) async fn handle_stream_error(self: &Arc<Self>, node: &Node) {
        self.set_logged_in(false);
        self.clear_response_waiters(node);
        let code = node
            .attrs
            .get("code")
            .map(ToString::to_string)
            .unwrap_or_default();
        let conflict_type = node
            .get_optional_child_by_tag(&["conflict"])
            .map(|conflict| conflict.attr_getter().optional_string("type"))
            .unwrap_or_default();
        if code == "515" {
            if self.config.disable_login_auto_reconnect {
                tracing::info!(
                    "got 515 code, but login autoreconnect is disabled, not reconnecting"
                );
                self.dispatch_event(Event::ManualLoginReconnect(ManualLoginReconnect))
                    .await;
                return;
            }
            tracing::info!("got 515 code, reconnecting");
            let client = Arc::clone(self);
            self.spawn(async move {
                client.disconnect().await;
                if let Err(error) = client.connect().await {
                    tracing::error!(error = %error, "failed to reconnect after 515 code");
                }
            });
        } else if code == "401" && conflict_type == "device_removed" {
            self.expect_disconnect();
            tracing::info!(
                "got device removed stream error, sending LoggedOut event and deleting session"
            );
            self.spawn_dispatch(Event::LoggedOut(LoggedOut {
                on_connect: false,
                reason: ConnectFailureReason::LOGGED_OUT,
            }));
            if let Err(error) = self.delete_device().await {
                tracing::warn!(error = %error, "failed to delete store after device_removed error");
            }
        } else if conflict_type == "replaced" {
            self.expect_disconnect();
            tracing::info!("got replaced stream error, sending StreamReplaced event");
            self.spawn_dispatch(Event::StreamReplaced(StreamReplaced));
        } else if code == "503" {
            // The server wants to restart; the disconnect is emitted as
            // Disconnected and auto-reconnect does its thing.
            tracing::warn!("got 503 stream error, assuming automatic reconnect will handle it");
        } else {
            tracing::error!(code = %code, "unknown stream error");
            self.spawn_dispatch(Event::StreamError(StreamError {
                code,
                raw: node.clone(),
            }));
        }
    }

    pub(crate) async fn handle_ib(self: &Arc<Self>, node: &Node) {
        for child in node.get_children() {
            let mut attrs = child.attr_getter();
            match child.tag.as_str() {
                "downgrade_webclient" => {
                    self.spawn_dispatch(Event::QrScannedWithoutMultidevice(
                        QrScannedWithoutMultidevice,
                    ));
                }
                "offline_preview" => {
                    let event = OfflineSyncPreview {
                        total: attrs.int("count"),
                        app_data_changes: attrs.int("appdata"),
                        messages: attrs.int("message"),
                        notifications: attrs.int("notification"),
                        receipts: attrs.int("receipt"),
                    };
                    self.dispatch_event(Event::OfflineSyncPreview(event)).await;
                }
                "offline" => {
                    let event = OfflineSyncCompleted {
                        count: attrs.int("count"),
                    };
                    self.dispatch_event(Event::OfflineSyncCompleted(event))
                        .await;
                }
                _ => {}
            }
        }
    }

    pub(crate) async fn handle_connect_failure(self: &Arc<Self>, node: &Node) {
        let mut attrs = node.attr_getter();
        let reason = ConnectFailureReason(attrs.int("reason"));
        let message = attrs.optional_string("message");
        let will_auto_reconnect = reason == ConnectFailureReason::SERVICE_UNAVAILABLE
            || reason == ConnectFailureReason::INTERNAL_SERVER_ERROR
            || reason == ConnectFailureReason::CAT_INVALID
            || reason == ConnectFailureReason::CAT_EXPIRED;
        if !will_auto_reconnect {
            // By default, expect a disconnect (i.e. prevent auto-reconnect).
            self.expect_disconnect();
        }
        if reason.0 == 403 {
            tracing::debug!("got 403 connect failure");
        }
        if reason.is_logged_out() {
            tracing::info!(reason = %reason, "got logged out connect failure, sending LoggedOut event and deleting session");
            self.spawn_dispatch(Event::LoggedOut(LoggedOut {
                on_connect: true,
                reason,
            }));
            if let Err(error) = self.delete_device().await {
                tracing::warn!(error = %error, reason = reason.0, "failed to delete store after failure");
            }
        } else if reason == ConnectFailureReason::TEMP_BANNED {
            tracing::warn!("temporary ban connect failure");
            self.spawn_dispatch(Event::TemporaryBan(TemporaryBan {
                code: TempBanReason(attrs.int("code")),
                expire: Duration::from_secs(u64::try_from(attrs.int("expire")).unwrap_or_default()),
            }));
        } else if reason == ConnectFailureReason::CLIENT_OUTDATED {
            tracing::error!(client_version = %get_wa_version(), "client outdated (405) connect failure");
            self.spawn_dispatch(Event::ClientOutdated(ClientOutdated));
        } else if will_auto_reconnect {
            tracing::warn!(
                reason = reason.0,
                "got connect failure, assuming automatic reconnect will handle it"
            );
        } else {
            tracing::warn!(reason = reason.0, "unknown connect failure");
            self.spawn_dispatch(Event::ConnectFailure(ConnectFailure {
                reason,
                message,
                raw: node.clone(),
            }));
        }
    }

    pub(crate) async fn handle_connect_success(self: &Arc<Self>, node: &Node) {
        if !self.paired.load(Ordering::SeqCst) {
            tracing::warn!("received connect success without pairing, ignoring");
            return;
        }
        tracing::info!("successfully authenticated");
        self.mark_connect_success();
        let mut attrs = node.attr_getter();
        let node_lid = attrs.jid("lid");
        if let Some(server_time) = attrs.unix_time("t") {
            let now = Utc::now();
            let rounded = now
                .with_timezone(&Utc)
                .timestamp_millis()
                .saturating_add(500)
                / 1000;
            let offset = (server_time.timestamp() - rounded) * 1_000_000_000;
            self.server_time_offset.store(offset, Ordering::SeqCst);
        }

        let mut updated_lid = None;
        {
            let mut store = self.store.write().await;
            if !store.lid.is_empty() && !node_lid.is_empty() && store.lid != node_lid {
                // This should probably never happen, but check just in case.
                tracing::warn!("stored LID doesn't match one in connect success");
                store.lid = Jid::default();
            }
            if store.lid.is_empty() && !node_lid.is_empty() {
                store.lid = node_lid;
                match store.save().await {
                    Err(error) => {
                        tracing::warn!(error = %error, "failed to save device after updating LID");
                    }
                    Ok(()) => tracing::info!("updated LID"),
                }
                updated_lid = Some((store.get_lid(), store.get_jid()));
            }
        }
        if let Some((lid, jid)) = updated_lid {
            self.store_lid_pn_mapping(&lid, &jid).await;
        }
        self.delete_expired_privacy_tokens().await;
        let client = Arc::clone(self);
        self.spawn(async move {
            let pre_keys = Arc::clone(&client.store.read().await.pre_keys);
            match pre_keys.uploaded_pre_key_count().await {
                Err(error) => {
                    tracing::error!(error = %error, "failed to get number of prekeys in database");
                }
                Ok(db_count) => match client.get_server_pre_key_count().await {
                    Err(error) => {
                        tracing::warn!(error = %error, "failed to get number of prekeys on server");
                    }
                    Ok(server_count) => {
                        tracing::debug!(db_count, server_count, "prekey counts");
                        if server_count < MIN_PRE_KEY_COUNT || db_count < MIN_PRE_KEY_COUNT {
                            client
                                .upload_pre_keys(db_count == 0 && server_count == 0)
                                .await;
                            let server_count = client.get_server_pre_key_count().await;
                            tracing::debug!(server_count = ?server_count.ok(), "prekey count after upload");
                        }
                    }
                },
            }
            if let Err(error) = client.set_passive(false).await {
                tracing::warn!(error = %error, "failed to send post-connect passive IQ");
            }
            client.dispatch_event(Event::Connected(Connected)).await;
            client.close_socket_wait_chan();
        });
    }

    /// Tells the server whether this device is passive. The client sends
    /// `set_passive(false)` itself after connecting.
    pub async fn set_passive(&self, passive: bool) -> Result<(), ClientError> {
        let tag = if passive { "passive" } else { "active" };
        self.send_iq(InfoQuery {
            namespace: "passive",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: tag.to_owned(),
                ..Node::default()
            }])),
            ..Default::default()
        })
        .await
        .map(|_| ())
    }
}
