//! Purchases: a reservation holds capacity under the purchase key and is
//! converted into a computer at once. A charged purchase provisions while
//! its charge settles in the billing worker (`Effect::Charge`); a refused
//! charge releases the computer.

use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{Clock, ComputerError, ComputerService, computer_name, internal};
use crate::domain::ids::ComputerId;
use crate::domain::models::{
    Funding, NewReservation, Purchase, PurchaseBilling, PurchaseRequest, Reservation, Reserved,
};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, ReserveError,
};

/// How long a reservation holds capacity before it is converted.
pub const RESERVATION_TTL: Duration = Duration::minutes(15);
/// How old a reservation is before the confirm worker converts it, so it
/// does not race the purchase request that made it.
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
    /// `extra_items`, in one subscription update keyed by the computer id).
    /// A retry with the same purchase key returns what the first attempt led
    /// to, so it never charges twice or buys a second computer. A team buys
    /// one charged computer at a time: another while one is unpaid is
    /// [`ComputerError::UnpaidComputer`]. An error always means nothing was
    /// bought; a conversion that failed is [`Purchase::Confirming`].
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
                span.record("outcome", "purchased");
                return Ok(Purchase::Ready(record.id()));
            }
            Err(ReserveError::SoldOut) => return Err(ComputerError::SoldOut(request.size)),
            Err(ReserveError::UnpaidComputer) => return Err(ComputerError::UnpaidComputer),
            Err(ReserveError::Storage(error)) => return Err(internal(error)),
        };
        span.record("computer_id", tracing::field::display(reservation.id));

        // Provision at once: the charge runs beside creation in the billing
        // worker (`Effect::Charge`), and a refused one releases the computer.
        match self.convert(&reservation).await {
            Ok(()) => {
                span.record("outcome", "ready");
                Ok(Purchase::Ready(reservation.id))
            }
            // The confirm worker converts it on a later pass.
            Err(error) => {
                tracing::error!(computer_id = %reservation.id, error = ?error,
                    "computer reserved but not converted; confirming later");
                span.record("outcome", "confirming");
                Ok(Purchase::Confirming(reservation.id))
            }
        }
    }

    /// Convert a reservation into its computer. Another worker may have
    /// converted it already, which is the same outcome.
    async fn convert(&self, reservation: &Reservation) -> Result<(), ComputerError> {
        let converted = self
            .repo
            .convert_reservation(reservation.id, self.clock.now())
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
                "a reservation disappeared without becoming a computer"
            )));
        }
        Ok(())
    }

    /// Convert reservations whose purchase request did not (it failed or
    /// was dropped between reserving and converting). Returns how many were
    /// converted.
    #[tracing::instrument(skip(self), err)]
    pub async fn confirm_reservations(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let due = self
            .repo
            .reservations_created_before(now - CONFIRM_DELAY, CONFIRM_BATCH)
            .await
            .map_err(internal)?;
        let mut converted = 0;
        for reservation in due {
            match self.convert(&reservation).await {
                Ok(()) => converted += 1,
                Err(error) => {
                    tracing::warn!(computer_id = %reservation.id, error = ?error,
                        "computer purchase not converted yet");
                }
            }
        }
        Ok(converted)
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
