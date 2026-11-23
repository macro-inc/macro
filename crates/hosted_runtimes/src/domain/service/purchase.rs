//! Purchases: a reservation holds capacity under the purchase key and is
//! converted into a computer at once. A charged one is
//! [`ComputerBilling::Charging`] while the request charges it beside the
//! guest's creation: success bills it, a definite refusal releases it, and
//! an unknown outcome hands the charge to the billing worker. A reservation
//! the request never converted is left to the confirm worker.

use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use tracing::Instrument;

use super::{Clock, ComputerError, ComputerService, computer_name, internal};
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{Billing as ComputerBilling, Charger, DeclineSeen, Event};
use crate::domain::models::{
    Funding, NewReservation, Purchase, PurchaseBilling, PurchaseRequest, Reservation, Reserved,
};
use crate::domain::ports::{
    Applied, Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, ItemCharge,
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

    /// [`Self::purchase_for_team`] for a computer that runs an agent
    /// teammate: the same rollout, billing policy and per-computer charge,
    /// with the computer linked to the agent's account. `request.created_by`
    /// is the admin buying it.
    #[tracing::instrument(skip(self, request, agent), fields(team_id = %request.team_id), err)]
    pub async fn purchase_for_agent(
        &self,
        mut request: PurchaseRequest,
        agent: MacroUserIdStr<'static>,
    ) -> Result<Purchase, ComputerError> {
        self.require_rollout(&request.created_by).await?;
        self.require_attached().await?;
        request.billing = self.purchase_billing(request.team_id).await?;
        self.purchase_linked(request, Some(agent)).await
    }

    /// Reserve units and convert them into a provisioning computer at once;
    /// a charged one is charged beside its creation (its own item plus
    /// `extra_items`, in one subscription update keyed by the computer id)
    /// and answered once the charge has a definite outcome. A retry with
    /// the same purchase key returns what the first attempt led to, so it
    /// never charges twice or buys a second computer. An error always means
    /// nothing was charged; an unknown charge outcome is
    /// [`Purchase::Confirming`] and settles in the billing worker.
    pub async fn purchase(&self, request: PurchaseRequest) -> Result<Purchase, ComputerError> {
        self.purchase_linked(request, None).await
    }

    #[tracing::instrument(
        name = "purchase",
        skip(self, request, agent),
        fields(team_id = %request.team_id, size = request.size.as_ref(), computer_id, billing_kind, outcome, for_agent = agent.is_some()),
        err
    )]
    async fn purchase_linked(
        &self,
        request: PurchaseRequest,
        agent: Option<MacroUserIdStr<'static>>,
    ) -> Result<Purchase, ComputerError> {
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
            // Computers are for paying teams: refused before anything is reserved.
            PurchaseBilling::Stripe => Funding::Stripe {
                price_id: self
                    .billing
                    .purchase_price(request.team_id, request.size)
                    .await?,
            },
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
                    agent,
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
                let state = record.healthy().map(|computer| &computer.state);
                if state.is_some_and(|state| state.billing.is_charging()) {
                    span.record("outcome", "confirming");
                    return Ok(Purchase::Confirming(record.id()));
                }
                if state.is_some_and(|state| state.declined()) {
                    span.record("outcome", "refused");
                    return Err(BillingError::PaymentFailed.into());
                }
                span.record("outcome", "purchased");
                return Ok(Purchase::Ready(record.id()));
            }
            Err(ReserveError::SoldOut) => return Err(ComputerError::SoldOut(request.size)),
            Err(ReserveError::Storage(error)) => return Err(internal(error)),
        };
        span.record("computer_id", tracing::field::display(reservation.id));

        let price_id = match &reservation.funding {
            Funding::Comped { reason } => {
                let billing = ComputerBilling::Comped {
                    reason: reason.clone(),
                };
                return match self.convert(&reservation, billing).await {
                    Ok(()) => {
                        span.record("outcome", "ready");
                        Ok(Purchase::Ready(reservation.id))
                    }
                    Err(error) => {
                        tracing::error!(computer_id = %reservation.id, error = ?error,
                            "computer reserved but not converted; confirming later");
                        span.record("outcome", "confirming");
                        Ok(Purchase::Confirming(reservation.id))
                    }
                };
            }
            Funding::Stripe { price_id } => price_id.clone(),
        };
        let outcome = self
            .charge_while_provisioning(&reservation, &price_id)
            .await;
        span.record(
            "outcome",
            outcome.as_ref().map_or("refused", Purchase::outcome),
        );
        outcome
    }

    /// Convert a charged purchase into a computer that provisions at once,
    /// then charge it while the fleet creates the guest. The computer's
    /// billing guard is held throughout, so a release fencing the charge
    /// waits for its outcome. Every failure past the conversion leaves the
    /// computer charging, for the billing worker to take over at
    /// [`crate::domain::lifecycle::CHARGE_TAKEOVER`].
    async fn charge_while_provisioning(
        &self,
        reservation: &Reservation,
        price_id: &stripe::PriceId,
    ) -> Result<Purchase, ComputerError> {
        let confirming = Purchase::Confirming(reservation.id);
        let _billing = match self.repo.lock_billing(reservation.id).await {
            Ok(guard) => guard,
            Err(error) => {
                tracing::error!(computer_id = %reservation.id, error = ?error,
                    "computer reserved but not converted; confirming later");
                return Ok(confirming);
            }
        };
        let billing = ComputerBilling::Charging {
            extra_items: reservation.extra_items.clone(),
            charger: Charger::Request,
        };
        if let Err(error) = self.convert(reservation, billing).await {
            // A conversion that committed before failing still charges here;
            // one that didn't is left to the confirm worker.
            let converted = matches!(self.repo.get(reservation.id).await, Ok(Some(_)));
            tracing::error!(computer_id = %reservation.id, error = ?error, converted,
                "computer conversion failed");
            if !converted {
                return Ok(confirming);
            }
        }

        let charge_span = tracing::info_span!(
            "computer.purchase.charge",
            computer_id = %reservation.id,
            outcome = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let charged = self
            .billing
            .add_computer(
                reservation.team_id,
                reservation.id,
                price_id,
                &reservation.extra_items,
                ItemCharge::Prorated,
                &reservation.charge_key(),
            )
            .instrument(charge_span.clone())
            .await;
        let (event, answer, outcome) = match charged {
            Ok(subscription_item) => (
                Event::ChargeSucceeded { subscription_item },
                Ok(Purchase::Ready(reservation.id)),
                "charged",
            ),
            Err(error) if error.is_definite() => (
                Event::ChargeFailed {
                    seen: DeclineSeen::ByBuyer,
                },
                Err(error.into()),
                "refused",
            ),
            Err(error) => {
                tracing::warn!(parent: &charge_span, computer_id = %reservation.id, error = ?error,
                    "computer charge outcome unknown; the billing worker settles it");
                (Event::ChargeUnsettled, Ok(confirming), "unknown")
            }
        };
        charge_span.record("outcome", outcome);
        if outcome != "charged" {
            charge_span.record("otel.status_code", "ERROR");
        }
        match self
            .repo
            .apply(reservation.id, event, self.clock.now())
            .await
        {
            Ok(Some(Applied::Changed(_))) => answer,
            // Released, quarantined or gone meanwhile: the release fences the
            // charge, so the outcome stands.
            Ok(Some(Applied::Rejected(_)) | None) => answer,
            Err(error) => {
                tracing::error!(computer_id = %reservation.id, error = ?error,
                    "computer charge outcome not recorded; the billing worker settles it");
                Ok(confirming)
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
