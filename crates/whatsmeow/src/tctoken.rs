// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow tctoken.go (MPL-2.0, Copyright (c) Tulir Asokan)

//! Trusted contact (privacy) tokens: when they expire, and issuing new ones.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::{Client, lock};
use crate::errors::ClientError;
use crate::request::{InfoQuery, IqType};
use crate::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, PSA_JID, SERVER_JID};

/// The duration of one bucket in seconds (7 days, AB prop `tctoken_duration`).
const TC_TOKEN_BUCKET_DURATION: i64 = 604_800;
/// The number of rolling buckets (~28 days, AB prop `tctoken_num_buckets`).
const TC_TOKEN_NUM_BUCKETS: i64 = 4;
const TC_TOKEN_DB_PRUNE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// The in-memory sender timestamps of issued tokens, with the last cleanup.
#[derive(Default)]
pub(crate) struct TcTokenSenderTimestamps {
    timestamps: HashMap<Jid, DateTime<Utc>>,
    last_cleanup: Option<DateTime<Utc>>,
}

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap_or_default()
}

pub(crate) fn current_tc_token_cutoff_timestamp() -> DateTime<Utc> {
    let current_bucket = Utc::now().timestamp() / TC_TOKEN_BUCKET_DURATION;
    let cutoff_bucket = current_bucket - (TC_TOKEN_NUM_BUCKETS - 1);
    timestamp(cutoff_bucket * TC_TOKEN_BUCKET_DURATION)
}

/// Whether a token received at the timestamp has expired; `None` is Go's zero time.
pub(crate) fn is_tc_token_expired(timestamp: Option<DateTime<Utc>>) -> bool {
    match timestamp {
        None => true,
        Some(timestamp) => timestamp < current_tc_token_cutoff_timestamp(),
    }
}

/// Whether the current bucket is newer than the bucket of the last issuance.
pub(crate) fn should_send_new_tc_token(sender_timestamp: Option<DateTime<Utc>>) -> bool {
    match sender_timestamp {
        None => true,
        Some(sender_timestamp) => {
            Utc::now().timestamp() / TC_TOKEN_BUCKET_DURATION
                > sender_timestamp.timestamp() / TC_TOKEN_BUCKET_DURATION
        }
    }
}

pub(crate) fn should_send_tc_token_in_chat_action(jid: &Jid) -> bool {
    let jid = jid.to_non_ad();
    (jid.server == DEFAULT_USER_SERVER || jid.server == HIDDEN_USER_SERVER)
        && jid.user != PSA_JID.user
        && !jid.is_bot()
}

impl Client {
    pub(crate) async fn resolve_tc_token_storage_lid(&self, jid: &Jid) -> Jid {
        let storage_jid = jid.to_non_ad();
        if storage_jid.server != DEFAULT_USER_SERVER {
            return storage_jid;
        }
        let lids = Arc::clone(&self.store.read().await.lids);
        match lids.get_lid_for_pn(&storage_jid).await {
            Err(error) => {
                tracing::debug!(error = %error, "failed to resolve LID for tctoken JID");
                storage_jid
            }
            Ok(None) => storage_jid,
            Ok(Some(lid)) if lid.is_empty() => storage_jid,
            Ok(Some(lid)) => lid.to_non_ad(),
        }
    }

    pub(crate) fn get_tc_token_sender_ts(&self, jid: &Jid) -> Option<DateTime<Utc>> {
        lock(&self.tc_token_sender_ts)
            .timestamps
            .get(&jid.to_non_ad())
            .copied()
    }

    pub(crate) fn validate_and_set_tc_token_sender_ts(
        &self,
        jid: &Jid,
        stored_sender_timestamp: Option<DateTime<Utc>>,
    ) -> bool {
        let mut state = lock(&self.tc_token_sender_ts);
        let key = jid.to_non_ad();
        if state.timestamps.contains_key(&key) {
            return true;
        }
        let Some(stored) = stored_sender_timestamp else {
            return false;
        };
        if stored < current_tc_token_cutoff_timestamp() {
            return false;
        }
        state.timestamps.insert(key, stored);
        unlocked_cleanup_tc_token_sender_ts_map(&mut state);
        true
    }

    pub(crate) fn set_tc_token_sender_ts(&self, jid: &Jid, sender_timestamp: DateTime<Utc>) {
        let mut state = lock(&self.tc_token_sender_ts);
        state.timestamps.insert(jid.to_non_ad(), sender_timestamp);
        unlocked_cleanup_tc_token_sender_ts_map(&mut state);
    }

    /// A stored, unexpired token for the user, if there is one.
    pub(crate) async fn ensure_tc_token(&self, jid: &Jid) -> Result<Option<Vec<u8>>, ClientError> {
        if self.get_own_id().await.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        self.delete_expired_privacy_tokens().await;
        let storage_jid = self.resolve_tc_token_storage_lid(jid).await;
        let privacy_tokens = Arc::clone(&self.store.read().await.privacy_tokens);
        let existing = privacy_tokens
            .get_privacy_token(&storage_jid)
            .await
            .map_err(|error| ClientError::from(error).wrap("failed to get privacy token"))?;
        let Some(existing) = existing else {
            return Ok(None);
        };
        self.validate_and_set_tc_token_sender_ts(&storage_jid, existing.sender_timestamp);
        if !existing.token.is_empty() && !is_tc_token_expired(Some(existing.timestamp)) {
            return Ok(Some(existing.token));
        }
        Ok(None)
    }

    /// Deletes expired tokens from the store, at most once a day.
    pub(crate) async fn delete_expired_privacy_tokens(&self) {
        let Ok(mut last_prune) = self.tc_token_db_prune.try_lock() else {
            return;
        };
        if last_prune.is_some_and(|last| last.elapsed() < TC_TOKEN_DB_PRUNE_INTERVAL) {
            return;
        }
        *last_prune = Some(tokio::time::Instant::now());
        drop(last_prune);
        let privacy_tokens = Arc::clone(&self.store.read().await.privacy_tokens);
        self.spawn(async move {
            match privacy_tokens
                .delete_expired_privacy_tokens(current_tc_token_cutoff_timestamp())
                .await
            {
                Err(error) => {
                    tracing::warn!(error = %error, "failed to remove expired tctokens from store")
                }
                Ok(deleted) if deleted > 0 => {
                    tracing::debug!(deleted, "removed expired tctokens from store")
                }
                Ok(_) => {}
            }
        });
    }

    /// Issues a token to the user and remembers when. Only called when a
    /// bucket boundary was crossed since the last issuance.
    pub(crate) async fn issue_privacy_token_and_save(
        &self,
        jid: Jid,
        sender_timestamp: DateTime<Utc>,
    ) {
        let storage_jid = jid.to_non_ad();
        if let Err(error) = self
            .issue_privacy_token(&storage_jid, sender_timestamp)
            .await
        {
            tracing::error!(error = %error, "failed to issue privacy token");
            return;
        }
        self.set_tc_token_sender_ts(&storage_jid, sender_timestamp);
        let privacy_tokens = Arc::clone(&self.store.read().await.privacy_tokens);
        let existing = match privacy_tokens.get_privacy_token(&storage_jid).await {
            Err(error) => {
                tracing::error!(error = %error, "failed to load tctoken while persisting sender timestamp");
                return;
            }
            Ok(existing) => existing,
        };
        let Some(mut existing) = existing.filter(|existing| !existing.token.is_empty()) else {
            return;
        };
        existing.sender_timestamp = Some(sender_timestamp);
        if let Err(error) = privacy_tokens.put_privacy_tokens(&[existing]).await {
            tracing::error!(error = %error, "failed to persist privacy token sender timestamp");
        }
    }

    async fn issue_privacy_token(
        &self,
        jid: &Jid,
        timestamp: DateTime<Utc>,
    ) -> Result<Node, ClientError> {
        self.send_iq(InfoQuery {
            namespace: "privacy",
            r#type: IqType::Set,
            to: SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "tokens".to_owned(),
                attrs: Attrs::new(),
                content: Some(NodeContent::Nodes(vec![Node {
                    tag: "token".to_owned(),
                    attrs: Attrs::from([
                        ("jid".to_owned(), jid.to_non_ad().into()),
                        ("t".to_owned(), timestamp.timestamp().to_string().into()),
                        ("type".to_owned(), "trusted_contact".into()),
                    ]),
                    content: None,
                }])),
            }])),
            ..Default::default()
        })
        .await
    }
}

fn unlocked_cleanup_tc_token_sender_ts_map(state: &mut TcTokenSenderTimestamps) {
    let now = Utc::now();
    if state
        .last_cleanup
        .is_some_and(|last| (now - last).num_seconds() < TC_TOKEN_BUCKET_DURATION)
    {
        return;
    }
    state.last_cleanup = Some(now);
    let cutoff = current_tc_token_cutoff_timestamp();
    state.timestamps.retain(|_, timestamp| *timestamp >= cutoff);
}
