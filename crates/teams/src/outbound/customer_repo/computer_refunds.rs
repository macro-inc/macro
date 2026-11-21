//! Undoing a computer's purchase: a credit note on the invoice its purchase
//! paid, for the lines of the computer's own price. The part the team paid by
//! card is refunded; a part paid from its credit balance goes back there.

use super::*;
use crate::domain::model::ComputerPurchaseCredit;

#[cfg(test)]
mod test;

/// Recent paid invoices searched for a computer's purchase, newest first.
/// A refund follows its purchase by minutes, so the purchase is among them.
const INVOICE_PAGE: u64 = 20;
/// The credit note metadata key carrying the refund's key, so a retry after
/// Stripe's idempotency window still finds the note it made.
const REFUND_KEY: &str = "computer_refund";

/// How a refund ended, recorded on its span.
#[derive(Debug, Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum RefundOutcome {
    /// A new credit note undid the purchase.
    Credited,
    /// An earlier attempt with the same key already had.
    AlreadyCredited,
    /// No paid invoice carries the computer: nothing was charged.
    NoPurchaseFound,
}

impl CustomerRepositoryImpl {
    #[tracing::instrument(
        name = "computer.refund",
        skip_all,
        fields(%computer_id, outcome = tracing::field::Empty),
        err
    )]
    pub(super) async fn refund_computer_purchase(
        &self,
        subscription_id: &stripe::SubscriptionId,
        computer_id: computer_id::ComputerId,
        idempotency_key: &str,
    ) -> Result<Option<ComputerPurchaseCredit>, CustomerError> {
        let span = tracing::Span::current();
        let computer_id = computer_id.to_string();
        let computer_id = computer_id.as_str();
        let mut params = stripe::ListInvoices::new();
        params.subscription = Some(subscription_id.clone());
        params.status = Some(stripe::InvoiceStatus::Paid);
        params.limit = Some(INVOICE_PAGE);
        let invoices = traced(
            stripe_span!("stripe.invoice.list", subscription_id = %subscription_id),
            stripe::Invoice::list(&self.client, &params),
        )
        .await
        .map_err(storage)?;
        for invoice in invoices.data {
            let lines = self.purchase_lines(&invoice, computer_id).await?;
            if lines.is_empty() {
                continue;
            }
            if let Some(credit) = self.credit_for(&invoice.id, idempotency_key).await? {
                span.record("outcome", RefundOutcome::AlreadyCredited.as_ref());
                return Ok(Some(credit));
            }
            let credit = self
                .credit_purchase(&invoice, lines, computer_id, idempotency_key)
                .await?;
            span.record("outcome", RefundOutcome::Credited.as_ref());
            return Ok(Some(credit));
        }
        span.record("outcome", RefundOutcome::NoPurchaseFound.as_ref());
        Ok(None)
    }

    /// The invoice's charged prorations of the computer's own price: the
    /// lines its purchase added.
    async fn purchase_lines(
        &self,
        invoice: &stripe::Invoice,
        computer_id: &str,
    ) -> Result<Vec<stripe::InvoiceLineItem>, CustomerError> {
        let Some(first_page) = &invoice.lines else {
            return Ok(Vec::new());
        };
        let lines = if first_page.has_more {
            self.all_invoice_lines(&invoice.id).await?
        } else {
            first_page.data.clone()
        };
        Ok(lines
            .into_iter()
            .filter(|line| line.proration && line.amount > 0)
            .filter(|line| {
                line.price
                    .as_ref()
                    .and_then(|price| price.metadata.as_ref())
                    .and_then(|metadata| metadata.get(COMPUTER_ID_KEY))
                    .is_some_and(|id| id == computer_id)
            })
            .collect())
    }

    async fn all_invoice_lines(
        &self,
        invoice_id: &stripe::InvoiceId,
    ) -> Result<Vec<stripe::InvoiceLineItem>, CustomerError> {
        #[derive(serde::Serialize)]
        struct Page {
            limit: u64,
            #[serde(skip_serializing_if = "Option::is_none")]
            starting_after: Option<String>,
        }
        let path = format!("/invoices/{invoice_id}/lines");
        let mut page = Page {
            limit: 100,
            starting_after: None,
        };
        let mut lines = Vec::new();
        loop {
            let read: stripe::List<stripe::InvoiceLineItem> = traced(
                stripe_span!("stripe.invoice_lines.list", invoice_id = %invoice_id),
                self.client.get_query(&path, &page),
            )
            .await
            .map_err(storage)?;
            let has_more = read.has_more;
            let last = read.data.last().map(|line| line.id.to_string());
            lines.extend(read.data);
            match (has_more, last) {
                (true, Some(last)) => page.starting_after = Some(last),
                _ => return Ok(lines),
            }
        }
    }

    /// The credit note an earlier attempt with this key made on the invoice.
    async fn credit_for(
        &self,
        invoice_id: &stripe::InvoiceId,
        idempotency_key: &str,
    ) -> Result<Option<ComputerPurchaseCredit>, CustomerError> {
        let mut params = stripe::ListCreditNotes::new();
        params.invoice = Some(invoice_id.clone());
        params.limit = Some(100);
        let notes = traced(
            stripe_span!("stripe.credit_note.list", invoice_id = %invoice_id),
            stripe::CreditNote::list(&self.client, &params),
        )
        .await
        .map_err(storage)?;
        Ok(notes
            .data
            .into_iter()
            .find(|note| {
                note.metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get(REFUND_KEY))
                    .is_some_and(|key| key == idempotency_key)
            })
            .map(credit))
    }

    /// Credit the lines in full: refund what the invoice took by card, less
    /// what earlier credit notes gave back, and put the rest on the team's
    /// credit balance it came from.
    async fn credit_purchase(
        &self,
        invoice: &stripe::Invoice,
        lines: Vec<stripe::InvoiceLineItem>,
        computer_id: &str,
        idempotency_key: &str,
    ) -> Result<ComputerPurchaseCredit, CustomerError> {
        let lines: Vec<stripe::CreateCreditNoteLines> = lines
            .into_iter()
            .map(|line| stripe::CreateCreditNoteLines {
                invoice_line_item: Some(line.id.to_string()),
                quantity: line.quantity,
                type_: stripe::CreateCreditNoteLinesType::InvoiceLineItem,
                ..Default::default()
            })
            .collect();
        let mut preview = stripe::CreateCreditNote::new(invoice.id.clone());
        preview.lines = Some(lines.clone());
        let previewed: stripe::CreditNote = traced(
            stripe_span!("stripe.credit_note.preview", invoice_id = %invoice.id),
            self.client.get_query("/credit_notes/preview", &preview),
        )
        .await
        .map_err(storage)?;
        let refundable = invoice.amount_paid.unwrap_or(0)
            - invoice.post_payment_credit_notes_amount.unwrap_or(0);
        let refund_amount = previewed.total.min(refundable.max(0));

        let mut create = stripe::CreateCreditNote::new(invoice.id.clone());
        create.lines = Some(lines);
        create.refund_amount = Some(refund_amount);
        create.credit_amount = Some(previewed.total - refund_amount);
        create.reason = Some(stripe::CreditNoteReason::ProductUnsatisfactory);
        create.metadata = Some(HashMap::from([
            (COMPUTER_ID_KEY.to_owned(), computer_id.to_owned()),
            (REFUND_KEY.to_owned(), idempotency_key.to_owned()),
        ]));
        let client =
            self.client
                .as_ref()
                .clone()
                .with_strategy(stripe::RequestStrategy::Idempotent(
                    idempotency_key.to_owned(),
                ));
        let note = traced(
            stripe_span!("stripe.credit_note.create", invoice_id = %invoice.id),
            stripe::CreditNote::create(&client, create),
        )
        .await
        .map_err(storage)?;
        tracing::info!(credit_note = %note.id, refund_amount, total = note.total,
            "computer purchase credited");
        Ok(credit(note))
    }
}

fn credit(note: stripe::CreditNote) -> ComputerPurchaseCredit {
    ComputerPurchaseCredit {
        credit_note: note.id,
        refund: note.refund.map(|refund| refund.id()),
    }
}
