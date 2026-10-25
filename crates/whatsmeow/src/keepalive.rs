// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow keepalive.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go keeps the durations in package variables so callers can change them;
// here they are constants.

//! Websocket keepalive pings.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use rand::Rng;
use tokio_util::sync::CancellationToken;

use crate::client::Client;
use crate::request::{InfoQuery, IqType};
use crate::types::SERVER_JID;
use crate::types::events::{Event, KeepAliveRestored, KeepAliveTimeout};

/// How long to wait for a response to a keepalive ping.
pub const KEEP_ALIVE_RESPONSE_DEADLINE: Duration = Duration::from_secs(10);
/// The minimum interval between keepalive pings.
pub const KEEP_ALIVE_INTERVAL_MIN: Duration = Duration::from_secs(20);
/// The maximum interval between keepalive pings.
pub const KEEP_ALIVE_INTERVAL_MAX: Duration = Duration::from_secs(30);
/// How long keepalives may fail before forcing a reconnect.
pub const KEEP_ALIVE_MAX_FAIL_TIME: Duration = Duration::from_secs(3 * 60);

impl Client {
    pub(crate) async fn keep_alive_loop(self: Arc<Self>, connection: CancellationToken) {
        let mut last_success = Utc::now();
        let mut error_count = 0;
        loop {
            let interval = rand::rng().random_range(
                KEEP_ALIVE_INTERVAL_MIN.as_millis()..KEEP_ALIVE_INTERVAL_MAX.as_millis(),
            );
            let interval = Duration::from_millis(u64::try_from(interval).unwrap_or(u64::MAX));
            tokio::select! {
                () = tokio::time::sleep(interval) => {}
                () = connection.cancelled() => return,
            }
            let (is_success, should_continue) = self.send_keep_alive(&connection).await;
            if !should_continue {
                return;
            } else if !is_success {
                error_count += 1;
                self.spawn_dispatch(Event::KeepAliveTimeout(KeepAliveTimeout {
                    error_count,
                    last_success,
                }));
                let since_success = (Utc::now() - last_success).to_std().unwrap_or_default();
                if self.config.enable_auto_reconnect && since_success > KEEP_ALIVE_MAX_FAIL_TIME {
                    tracing::debug!("forcing reconnect due to keepalive failure");
                    self.disconnect().await;
                    self.reset_expected_disconnect();
                    let client = Arc::clone(&self);
                    self.spawn(async move { client.auto_reconnect().await });
                }
            } else {
                if error_count > 0 {
                    error_count = 0;
                    self.spawn_dispatch(Event::KeepAliveRestored(KeepAliveRestored));
                }
                last_success = Utc::now();
            }
        }
    }

    /// Sends one ping; returns (is success, should continue).
    async fn send_keep_alive(&self, connection: &CancellationToken) -> (bool, bool) {
        let response = self
            .send_iq_async(InfoQuery {
                namespace: "w:p",
                r#type: IqType::Get,
                to: SERVER_JID.clone(),
                ..Default::default()
            })
            .await;
        if connection.is_cancelled() {
            return (false, false);
        }
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(error = %error, "failed to send keepalive");
                return (false, true);
            }
        };
        tokio::select! {
            _ = response => (true, true),
            () = tokio::time::sleep(KEEP_ALIVE_RESPONSE_DEADLINE) => {
                tracing::warn!("keepalive timed out");
                (false, true)
            }
            () = connection.cancelled() => (false, false),
        }
    }
}
