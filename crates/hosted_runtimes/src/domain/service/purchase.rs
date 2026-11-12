//! Purchases: a reservation holds capacity while the charge is confirmed;
//! a definite success converts it into a computer, a definite refusal
//! deletes it, and an unknown outcome leaves it to the confirm worker.

use chrono::Duration;
use uuid::Uuid;

use super::{Clock, ComputerError, ComputerService, computer_name, internal};
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::Billing as ComputerBilling;
use crate::domain::models::{
    Funding, NewReservation, Purchase, PurchaseBilling, PurchaseRequest, Reservation, Reserved,
};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, ItemCharge,
    ReserveError,
};

/// How long a reservation holds capacity while its charge is confirmed;
/// after this the confirm worker settles it for good.
pub const RESERVATION_TTL: Duration = Duration::minutes(15);
/// How old a reservation is before the confirm worker replays its charge,
/// so it does not race the purchase request that made it.
pub const CONFIRM_DELAY: Duration = Duration::minutes(2);
/// Reservations the confirm worker settles per pass.
const CONFIRM_BATCH: u32 = 16;

impl<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
> ComputerService<Repo, Bill, Time, Attachment, Policy>
{
    /// Team callers cannot choose their funding source.
    #[tracing::instrument(skip(self, request), fields(team_id = %request.team_id), err)]
    pub async fn purchase_for_team(
        &self,
        mut request: PurchaseRequest,
    ) -> Result<Purchase, ComputerError> {
        self.require_rollout(&request.created_by).await?;
        self.require_attached().await?;
        request.billing = self.purchase_billing(request.team_id).await?;
        self.purchase(request).await
    }

    /// Reserve units, then confirm a comp or charge the computer's own item
    /// (plus `extra_items`) in one subscription update. A retry with the same
    /// purchase key returns what the first attempt led to, so it never
    /// charges twice or buys a second computer. An error always means
    /// nothing was charged; an unknown charge outcome, or a charge whose
    /// conversion failed, is [`Purchase::Confirming`].
    #[tracing::instrument(
        skip(self, request),
        fields(team_id = %request.team_id, size = request.size.as_ref(), computer_id, billing_kind, outcome),
        err
    )]
    pub async fn purchase(&self, request: PurchaseRequest) -> Result<Purchase, ComputerError> {
        self.require_attached().await?;
        if !self.billing.sales_available() {
            return Err(BillingError::NotAvailable.into());
        }
        let span = tracing::Span::current();
        if matches!(request.billing, PurchaseBilling::Comped { .. })
            && !request.extra_items.is_empty()
        {
            return Err(ComputerError::CompedExtraItems);
        }
        let name = computer_name(request.name.as_deref())?;
        let entry = self.size_spec(request.size)?;
        let funding = match &request.billing {
            PurchaseBilling::Stripe => {
                // Computers are for paying teams: refused before anything is reserved.
                self.billing.require_paid_plan(request.team_id).await?;
                Funding::Stripe {
                    price_id: self
                        .billing
                        .quote(request.team_id, request.size)
                        .await?
                        .price_id,
                }
            }
            PurchaseBilling::Comped { reason } => Funding::Comped {
                reason: reason.clone(),
            },
        };
        span.record("billing_kind", funding.kind());

        let now = self.clock.now();
        let reserved = self
            .repo
            .reserve(
                NewReservation {
                    id: ComputerId::new_from_uuid(Uuid::now_v7()),
                    team_id: request.team_id,
                    purchase_key: request.purchase_key,
                    name,
                    size: request.size,
                    resources: entry.resources,
                    catalog_entry: entry.id.clone(),
                    funding,
                    created_by: request.created_by,
                    extra_items: request.extra_items,
                    provision_traceparent: crate::domain::telemetry::traceparent(),
                },
                now,
                now + RESERVATION_TTL,
            )
            .await;
        let reservation = match reserved {
            Ok(Reserved::New(reservation)) => reservation,
            Ok(Reserved::Pending(reservation)) => {
                same_purchase(&reservation, request.team_id, request.size)?;
                span.record("outcome", "pending");
                return Ok(Purchase::Confirming(reservation.id));
            }
            Ok(Reserved::Purchased(record)) => {
                if record.team_id() != request.team_id
                    || record
                        .healthy()
                        .is_some_and(|computer| computer.size != request.size)
                {
                    return Err(ComputerError::PurchaseKeyConflict);
                }
                span.record("outcome", "purchased");
                return Ok(Purchase::Ready(record.id()));
            }
            Err(ReserveError::SoldOut) => return Err(ComputerError::SoldOut(request.size)),
            Err(ReserveError::Storage(error)) => return Err(internal(error)),
        };
        span.record("computer_id", tracing::field::display(reservation.id));

        let outcome = match &reservation.funding {
            Funding::Comped { reason } => Ok(ComputerBilling::Comped {
                reason: reason.clone(),
            }),
            Funding::Stripe { price_id } => self
                .billing
                .add_computer(
                    reservation.team_id,
                    reservation.id,
                    price_id,
                    &reservation.extra_items,
                    ItemCharge::Prorated,
                    &reservation.charge_key(),
                )
                .await
                .map(|subscription_item| ComputerBilling::Active { subscription_item }),
        };
        match outcome {
            Ok(billing) => match self.convert(&reservation, billing).await {
                Ok(()) => {
                    span.record("outcome", "ready");
                    Ok(Purchase::Ready(reservation.id))
                }
                // Charged: never an error, or a new attempt would buy again.
                // The confirm worker replays the charge (a no-op) and converts.
                Err(error) => {
                    tracing::error!(computer_id = %reservation.id, error = ?error,
                        "computer charged but not converted; confirming later");
                    span.record("outcome", "confirming");
                    Ok(Purchase::Confirming(reservation.id))
                }
            },
            Err(error) if error.is_definite() => {
                self.repo
                    .delete_reservation(reservation.id)
                    .await
                    .map_err(internal)?;
                span.record("outcome", "refused");
                Err(error.into())
            }
            Err(error) => {
                tracing::warn!(computer_id = %reservation.id, error = ?error,
                    "computer charge outcome unknown; confirming later");
                span.record("outcome", "confirming");
                Ok(Purchase::Confirming(reservation.id))
            }
        }
    }

    /// Convert a reservation whose charge succeeded. Another worker may have
    /// converted it already, which is the same outcome.
    async fn convert(
        &self,
        reservation: &Reservation,
        billing: ComputerBilling,
    ) -> Result<(), ComputerError> {
        let converted = self
            .repo
            .convert_reservation(reservation.id, billing, self.clock.now())
            .await
            .map_err(internal)?;
        if converted.is_none()
            && self
                .repo
                .get(reservation.id)
                .await
                .map_err(internal)?
                .is_none()
        {
            return Err(ComputerError::Internal(rootcause::report!(
                "a charged reservation disappeared without becoming a computer"
            )));
        }
        Ok(())
    }

    /// Settle purchases whose request did not: replay each charge with its
    /// original idempotency key until the reservation expires, then give up
    /// on the charge for good, converting only if the subscription carries
    /// the computer's item. Returns how many reservations were settled.
    #[tracing::instrument(skip(self), err)]
    pub async fn confirm_reservations(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let due = self
            .repo
            .reservations_created_before(now - CONFIRM_DELAY, CONFIRM_BATCH)
            .await
            .map_err(internal)?;
        let mut settled = 0;
        for reservation in due {
            match self.confirm_reservation(&reservation, now).await {
                Ok(true) => settled += 1,
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(computer_id = %reservation.id, error = ?error,
                        "computer purchase not confirmed yet");
                }
            }
        }
        Ok(settled)
    }

    #[tracing::instrument(skip(self, reservation), fields(computer_id = %reservation.id, expired), err)]
    async fn confirm_reservation(
        &self,
        reservation: &Reservation,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<bool, ComputerError> {
        let expired = now >= reservation.expires_at;
        tracing::Span::current().record("expired", expired);
        let price_id = match &reservation.funding {
            Funding::Comped { reason } => {
                self.convert(
                    reservation,
                    ComputerBilling::Comped {
                        reason: reason.clone(),
                    },
                )
                .await?;
                return Ok(true);
            }
            Funding::Stripe { price_id } => price_id,
        };
        if expired {
            let settled = self
                .billing
                .settle_computer_add(
                    reservation.team_id,
                    reservation.id,
                    &reservation.charge_key(),
                )
                .await
                .inspect_err(|error| {
                    tracing::error!(computer_id = %reservation.id, error = ?error,
                        "computer payment unresolved");
                })?;
            match settled {
                Some(subscription_item) => {
                    self.convert(reservation, ComputerBilling::Active { subscription_item })
                        .await?;
                }
                None => {
                    tracing::info!(computer_id = %reservation.id,
                        "computer purchase expired uncharged");
                    self.repo
                        .delete_reservation(reservation.id)
                        .await
                        .map_err(internal)?;
                }
            }
            return Ok(true);
        }
        match self
            .billing
            .add_computer(
                reservation.team_id,
                reservation.id,
                price_id,
                &reservation.extra_items,
                ItemCharge::Prorated,
                &reservation.charge_key(),
            )
            .await
        {
            Ok(subscription_item) => {
                self.convert(reservation, ComputerBilling::Active { subscription_item })
                    .await?;
                Ok(true)
            }
            Err(error) if error.is_definite() => {
                self.repo
                    .delete_reservation(reservation.id)
                    .await
                    .map_err(internal)?;
                Ok(true)
            }
            Err(error) => Err(error.into()),
        }
    }
}

/// A key reused for another team's or size's purchase is a client bug, not a retry.
fn same_purchase(
    reservation: &Reservation,
    team_id: Uuid,
    size: crate::domain::size::ComputerSize,
) -> Result<(), ComputerError> {
    if reservation.team_id != team_id || reservation.size != size {
        return Err(ComputerError::PurchaseKeyConflict);
    }
    Ok(())
}
