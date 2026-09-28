//! Asks the authentication service (which owns Stripe) to settle a payer.

use crate::domain::SettlementTrigger;
use authentication_service_client::AuthServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use std::time::Duration;

/// Pauses between attempts; the last entry is the number of attempts.
const RETRY_BACKOFF: [Duration; 2] = [Duration::from_secs(1), Duration::from_secs(5)];

/// [`SettlementTrigger`] over the internal auth-service API. Runs on a
/// background task with a short bounded retry. Settlement is idempotent and
/// is requested again by the payer's next completion and by every Billing
/// page view (the summary endpoint settles first), so a request that still
/// fails after the retries is picked up there rather than queued durably.
#[derive(Clone)]
pub struct HttpSettlementTrigger {
    client: Arc<AuthServiceClient>,
}

impl HttpSettlementTrigger {
    /// Wrap an internal auth-service client.
    pub fn new(client: Arc<AuthServiceClient>) -> Self {
        Self { client }
    }
}

impl SettlementTrigger for HttpSettlementTrigger {
    fn request_settlement(&self, payer: MacroUserIdStr<'static>) {
        let client = self.client.clone();
        tokio::spawn(async move {
            let mut backoff = RETRY_BACKOFF.iter();
            loop {
                let Err(e) = client.settle_ai_billing(payer.as_ref()).await else {
                    return;
                };
                match backoff.next() {
                    Some(pause) => {
                        tracing::warn!(error = ?e, "ai billing settlement request failed; retrying");
                        tokio::time::sleep(*pause).await;
                    }
                    None => {
                        tracing::error!(
                            error = ?e,
                            attempts = RETRY_BACKOFF.len() + 1,
                            "ai billing settlement request failed; the next completion or billing page view retries"
                        );
                        return;
                    }
                }
            }
        });
    }
}
