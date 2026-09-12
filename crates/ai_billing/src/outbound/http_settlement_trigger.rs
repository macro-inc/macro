//! Asks the authentication service (which owns Stripe) to settle a payer.

use crate::domain::SettlementTrigger;
use authentication_service_client::AuthServiceClient;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

/// [`SettlementTrigger`] over the internal auth-service API. Fire-and-forget:
/// the request runs on a background task and failures are only logged; the
/// next completion or the payer's next Billing page view triggers again.
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
            if let Err(e) = client.settle_ai_billing(payer.as_ref()).await {
                tracing::warn!(error = ?e, payer = %payer, "ai billing settlement request failed");
            }
        });
    }
}
