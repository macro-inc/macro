//! Reads the subscription period through the authentication service, which
//! owns Stripe.

#[cfg(test)]
mod test;

use super::NoOpPaymentGateway;
use crate::domain::{
    BillingError, BillingPeriod, CreditCheckoutRequest, CreditReloadRequest, InvoiceOutcome,
    OverageChargeRequest, PaymentGateway, Result, SubscriptionScope,
};
use authentication_service_client::AuthServiceClient;
use macro_uuid::Uuid;
use std::sync::Arc;
use std::time::Duration;

/// The read sits on the AI request path and a failed read degrades to the
/// stored anchor, so it gets a third of the client's 15 s default.
const SUBSCRIPTION_PERIOD_TIMEOUT: Duration = Duration::from_secs(5);

/// [`PaymentGateway`] for the document cognition service, which gates AI
/// requests but does not own Stripe. Reads the subscription period through the
/// authentication service and refuses to pay like [`NoOpPaymentGateway`]. The
/// client must present the authentication service's own key, which the other
/// gate hosts do not hold.
#[derive(Clone)]
pub struct HttpPaymentGateway {
    client: Arc<AuthServiceClient>,
}

impl HttpPaymentGateway {
    /// Wrap an internal auth-service client.
    pub fn new(client: Arc<AuthServiceClient>) -> Self {
        Self { client }
    }
}

impl PaymentGateway for HttpPaymentGateway {
    async fn create_credit_checkout(&self, request: CreditCheckoutRequest) -> Result<String> {
        NoOpPaymentGateway.create_credit_checkout(request).await
    }

    async fn open_overage_invoice(&self, request: OverageChargeRequest) -> Result<String> {
        NoOpPaymentGateway.open_overage_invoice(request).await
    }

    async fn open_credit_reload_invoice(&self, request: CreditReloadRequest) -> Result<String> {
        NoOpPaymentGateway.open_credit_reload_invoice(request).await
    }

    async fn pay_overage_invoice(
        &self,
        charge_id: Uuid,
        invoice_id: &str,
        scope: SubscriptionScope,
    ) -> Result<InvoiceOutcome> {
        NoOpPaymentGateway
            .pay_overage_invoice(charge_id, invoice_id, scope)
            .await
    }

    async fn invoice_outcome(&self, invoice_id: &str) -> Result<Option<InvoiceOutcome>> {
        NoOpPaymentGateway.invoice_outcome(invoice_id).await
    }

    async fn subscription_period(
        &self,
        customer_id: &str,
        scope: SubscriptionScope,
    ) -> Result<Option<BillingPeriod>> {
        let team_id = match scope {
            SubscriptionScope::Personal => None,
            SubscriptionScope::Team { team_id } => Some(team_id),
        };
        let period = self
            .client
            .ai_subscription_period(customer_id, team_id, SUBSCRIPTION_PERIOD_TIMEOUT)
            .await
            .map_err(|e| {
                BillingError::Payment(
                    anyhow::Error::new(e)
                        .context("reading the subscription period from the authentication service"),
                )
            })?;
        Ok(period.map(|period| BillingPeriod {
            start: period.start,
            end: period.end,
        }))
    }
}
