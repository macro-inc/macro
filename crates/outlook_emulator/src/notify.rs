//! Calling subscribers: the validation handshake of a new subscription,
//! and the delivery of change and lifecycle notifications.

use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;

use crate::state::NotificationJob;
use crate::{NotificationDelivery, OutlookEmulator};

/// Graph gives a subscriber ten seconds to answer.
pub(crate) const SUBSCRIBER_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ATTEMPTS: u32 = 3;
const FIRST_RETRY_DELAY: Duration = Duration::from_secs(1);

impl OutlookEmulator {
    fn record(&self, delivery: NotificationDelivery) {
        self.with_state(|state| {
            let at = state.now();
            state
                .notifications
                .push(NotificationDelivery { at, ..delivery });
        });
    }

    /// Posts a validation token to a subscriber's URL, which must answer
    /// 200 with the token as plain text, as Graph requires before it
    /// creates a subscription.
    pub(crate) async fn validate_endpoint(
        &self,
        subscription_id: &str,
        endpoint: &str,
    ) -> Result<(), String> {
        let token = format!(
            "Validation: Testing client application reachability for subscription Request-Id: {}",
            uuid::Uuid::now_v7()
        );
        let mut url = url::Url::parse(endpoint)
            .map_err(|_| "Notification endpoint is not a valid URL.".to_string())?;
        url.query_pairs_mut().append_pair("validationToken", &token);

        let sent = self
            .inner
            .http
            .post(url)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Content-Length", 0)
            .send()
            .await;
        let (status, outcome) = match sent {
            Err(error) => {
                let reason = error.without_url().to_string();
                (
                    None,
                    Err(format!(
                        "Notification endpoint could not be reached: {reason}"
                    )),
                )
            }
            Ok(response) => {
                let status = response.status().as_u16();
                let echoed = response.text().await.unwrap_or_default();
                let outcome = match (status, echoed == token) {
                    (200, true) => Ok(()),
                    (200, false) => Err(
                        "Notification endpoint must respond with the validation token as plain text."
                            .to_string(),
                    ),
                    _ => Err(format!(
                        "Notification endpoint must respond with 200 OK to validation request; it answered {status}."
                    )),
                };
                (Some(status), outcome)
            }
        };

        self.record(NotificationDelivery {
            at: chrono::DateTime::UNIX_EPOCH,
            subscription_id: subscription_id.to_string(),
            url: endpoint.to_string(),
            kind: "validation".to_string(),
            body: Value::Null,
            status,
            error: outcome.clone().err(),
            attempts: 1,
        });
        outcome
    }
}

/// Posts each queued notification to its subscriber, retrying one that is
/// not acknowledged with a 2xx, and records the outcome.
pub(crate) async fn deliver_jobs(
    emulator: OutlookEmulator,
    mut jobs: mpsc::UnboundedReceiver<NotificationJob>,
) {
    let cancel = emulator.inner.cancel.clone();
    loop {
        let job = tokio::select! {
            () = cancel.cancelled() => return,
            job = jobs.recv() => match job {
                Some(job) => job,
                None => return,
            },
        };

        let mut attempts = 0;
        let mut delay = FIRST_RETRY_DELAY;
        let outcome = loop {
            attempts += 1;
            let outcome = emulator
                .inner
                .http
                .post(&job.url)
                .json(&job.body)
                .send()
                .await
                .map(|response| response.status().as_u16())
                .map_err(|error| error.without_url().to_string());
            let acknowledged = matches!(outcome, Ok(status) if (200..300).contains(&status));
            if acknowledged || attempts == MAX_ATTEMPTS {
                break outcome;
            }
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(delay) => {}
            }
            delay *= 2;
        };

        emulator.record(NotificationDelivery {
            at: chrono::DateTime::UNIX_EPOCH,
            subscription_id: job.subscription_id,
            url: job.url,
            kind: job.kind.to_string(),
            body: job.body,
            status: outcome.as_ref().ok().copied(),
            error: outcome.err(),
            attempts,
        });
    }
}
