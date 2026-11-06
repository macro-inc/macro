//! The team-facing computer service: buy, quote, read, power, retry, cancel and
//! release. It runs where Stripe lives (authentication_service), so it also
//! carries out billing effects.

use macro_user_id::user_id::MacroUserIdStr;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{Effect, EffectWorker, Event, Phase};
use crate::domain::models::{
    Computer, ComputerName, ComputerRecord, ComputerStatus, NewComputer, PurchaseBilling,
    PurchaseRequest, Quote, SizeOffer,
};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, NoComps, ReserveError,
};
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

const DEFAULT_NAME: &str = "Macro computer";
/// Billing effects leased per worker pass.
const BILLING_BATCH: u32 = 16;

/// Errors from the computer service.
#[derive(Debug, thiserror::Error)]
pub enum ComputerError {
    /// No computer exists for this team and identity.
    #[error("computer not found")]
    NotFound,
    /// The caller is outside the computer rollout.
    #[error("Macro computers are not enabled for this user")]
    RolloutDisabled,
    /// Only failed computers may be retried.
    #[error("only a failed computer can be retried")]
    NotFailed,
    /// No host has enough sale capacity.
    #[error("this size is sold out")]
    SoldOut,
    /// Request violates a computer input contract.
    #[error("{0}")]
    BadRequest(String),
    /// Confirmation does not match the computer name.
    #[error("type the computer's name to release it")]
    ConfirmationMismatch,
    /// Subscription billing failed.
    #[error(transparent)]
    Billing(#[from] BillingError),
    /// An adapter operation failed.
    #[error("internal computer error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for ComputerError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

fn internal<Err: std::error::Error + Send + Sync + 'static>(error: Err) -> ComputerError {
    ComputerError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Clock seam so tests control time.
pub trait Clock: Send + Sync + 'static {
    /// Return the current time.
    fn now(&self) -> DateTime<Utc>;
}

/// The wall clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Buy, read and manage a team's computers.
///
/// Callers authorize first: team routes require an admin receipt for writes
/// and a member receipt for reads, and pass the receipt's team id here.
pub struct ComputerService<Repo, Bill, Time, Policy = NoComps> {
    rollout: crate::domain::rollout::ComputerRollout,
    comp_policy: Policy,
    catalog: Vec<crate::domain::size::CatalogEntry>,
    repo: Repo,
    billing: Bill,
    clock: Time,
}

impl<Repo, Bill, Time> ComputerService<Repo, Bill, Time>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
{
    /// Compose the repository, billing provider and clock.
    pub fn new(repo: Repo, billing: Bill, clock: Time) -> Self {
        Self {
            rollout: Default::default(),
            comp_policy: NoComps,
            catalog: crate::domain::size::current_catalog(),
            repo,
            billing,
            clock,
        }
    }

    /// Replace the default policy at the composition root.
    pub fn with_comp_policy<Policy: CompPolicy>(
        self,
        comp_policy: Policy,
    ) -> ComputerService<Repo, Bill, Time, Policy> {
        ComputerService {
            rollout: self.rollout,
            repo: self.repo,
            billing: self.billing,
            clock: self.clock,
            comp_policy,
            catalog: self.catalog,
        }
    }
}

impl<Repo: ComputerRepo, Bill: Billing, Time: Clock, Policy: CompPolicy>
    ComputerService<Repo, Bill, Time, Policy>
{
    /// Configure the fail-closed rollout at the composition root.
    pub fn with_rollout(mut self, rollout: crate::domain::rollout::ComputerRollout) -> Self {
        self.rollout = rollout;
        self
    }

    async fn require_rollout(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<(), ComputerError> {
        if !self.rollout.enabled(user_id).await {
            return Err(ComputerError::RolloutDisabled);
        }
        Ok(())
    }

    /// Select the purchase catalog at the composition root.
    pub fn with_catalog(mut self, catalog: Vec<crate::domain::size::CatalogEntry>) -> Self {
        self.catalog = catalog;
        self
    }

    /// The purchase catalog selected at composition, independent of billing.
    pub fn catalog(&self) -> &[crate::domain::size::CatalogEntry] {
        &self.catalog
    }

    /// The configured offer for a size, or an error when that size is not offered.
    pub fn size_spec(
        &self,
        size: ComputerSize,
    ) -> Result<&crate::domain::size::CatalogEntry, ComputerError> {
        self.catalog
            .iter()
            .find(|entry| entry.size == size)
            .ok_or_else(|| ComputerError::BadRequest("size is not offered".to_owned()))
    }

    /// Resolve complimentary eligibility on the server.
    #[tracing::instrument(skip(self), err)]
    async fn purchase_billing(&self, team_id: Uuid) -> Result<PurchaseBilling, ComputerError> {
        Ok(
            match self
                .comp_policy
                .comp_reason(team_id)
                .await
                .map_err(internal)?
            {
                Some(reason) => PurchaseBilling::Comped { reason },
                None => PurchaseBilling::Stripe,
            },
        )
    }

    /// Team callers cannot choose their funding source.
    #[tracing::instrument(skip(self, request), fields(team_id = %request.team_id), err)]
    pub async fn purchase_for_team(
        &self,
        mut request: PurchaseRequest,
    ) -> Result<ComputerId, ComputerError> {
        self.require_rollout(&request.created_by).await?;
        request.billing = self.purchase_billing(request.team_id).await?;
        self.purchase(request).await
    }

    /// Quote using server-side team policy.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn quote_for_team(
        &self,
        user_id: &MacroUserIdStr<'static>,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<Quote, ComputerError> {
        self.require_rollout(user_id).await?;
        self.quote(team_id, size, &self.purchase_billing(team_id).await?)
            .await
    }

    /// The price of one computer of `size` for the team.
    #[tracing::instrument(skip(self, billing), err)]
    pub async fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
        billing: &PurchaseBilling,
    ) -> Result<Quote, ComputerError> {
        self.size_spec(size)?;
        let quote = self.billing.quote(team_id, size).await;
        match billing {
            PurchaseBilling::Stripe => Ok(quote?),
            PurchaseBilling::Comped { .. } => {
                let mut quote = quote?;
                quote.amount = 0;
                Ok(quote)
            }
        }
    }

    /// Every size with its price, availability and the caller's notify requests.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn offers(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<SizeOffer>, ComputerError> {
        self.require_rollout(&user_id).await?;
        let sold_out = self
            .repo
            .sold_out_sizes(&self.catalog, false)
            .await
            .map_err(internal)?;
        let always_on_sold_out = self
            .repo
            .sold_out_sizes(&self.catalog, true)
            .await
            .map_err(internal)?;
        let notify = self
            .repo
            .notify_requests(team_id, user_id)
            .await
            .map_err(internal)?;

        let billing = self.purchase_billing(team_id).await?;
        let mut offers = Vec::new();
        for entry in &self.catalog {
            let size = entry.size;
            offers.push(SizeOffer {
                size,
                vcpus: entry.resources.vcpus.get(),
                memory_gb: entry.resources.memory_gib.get(),
                disk_gb: entry.resources.disk_gib.get(),
                quote: self.quote(team_id, size, &billing).await?,
                sold_out: sold_out.contains(&size),
                always_on_sold_out: always_on_sold_out.contains(&size),
                notify_requested: notify.contains(&size),
            });
        }
        Ok(offers)
    }

    /// Reserve units, confirm a comp or bill with `extra_items` in one
    /// subscription update, then start provisioning. Returns the
    /// computer id at once; [`Self::status`] reports setup progress.
    #[tracing::instrument(
        skip(self, request),
        fields(team_id = %request.team_id, size = request.size.as_ref(), computer_id, comped = matches!(&request.billing, PurchaseBilling::Comped { .. })),
        err
    )]
    pub async fn purchase(&self, request: PurchaseRequest) -> Result<ComputerId, ComputerError> {
        if !self.billing.sales_available() {
            return Err(BillingError::NotAvailable.into());
        }
        if matches!(request.billing, PurchaseBilling::Comped { .. })
            && !request.extra_items.is_empty()
        {
            return Err(ComputerError::BadRequest(
                "comped purchases cannot add subscription items".to_owned(),
            ));
        }
        if let Some(persona) = &request.persona {
            validate_persona(persona)?;
        }
        let name = computer_name(&request)?;
        let computer_id = ComputerId::new_from_uuid(Uuid::now_v7());
        tracing::Span::current().record("computer_id", tracing::field::display(computer_id));

        let entry = self.size_spec(request.size)?;
        let price_id = match request.billing {
            PurchaseBilling::Stripe => Some(
                self.billing
                    .quote(request.team_id, request.size)
                    .await?
                    .price_id,
            ),
            PurchaseBilling::Comped { .. } => None,
        };

        let reserved = self
            .repo
            .reserve(
                NewComputer {
                    billing: request.billing.clone(),
                    extra_items: request.extra_items.clone(),
                    id: computer_id,
                    team_id: request.team_id,
                    name,
                    size: request.size,
                    resources: entry.resources,
                    catalog_entry: entry.id.clone(),
                    price_id,
                    persona: request.persona,
                    created_by: request.created_by,
                },
                self.clock.now(),
            )
            .await;
        match reserved {
            Ok(_) => {}
            Err(ReserveError::SoldOut) => return Err(ComputerError::SoldOut),
            Err(ReserveError::Storage(error)) => return Err(internal(error)),
        }

        if matches!(request.billing, PurchaseBilling::Stripe) {
            self.confirm_payment(computer_id, &request.extra_items)
                .await?;
        }

        Ok(computer_id)
    }

    /// One of the team's computers.
    #[tracing::instrument(skip(self), err)]
    pub async fn status(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        Ok(self.team_record(team_id, computer_id).await?.status())
    }

    /// The team's computers, oldest first.
    #[tracing::instrument(skip(self), err)]
    pub async fn list(&self, team_id: Uuid) -> Result<Vec<ComputerStatus>, ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        Ok(computers.iter().map(ComputerRecord::status).collect())
    }

    /// Apply the team-requested power state.
    #[tracing::instrument(skip(self), err)]
    pub async fn set_power(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        on: bool,
    ) -> Result<ComputerStatus, ComputerError> {
        let event = if on { Event::PowerOn } else { Event::PowerOff };
        self.apply_for_team(team_id, computer_id, event).await
    }

    /// Retry a failed computer without changing its purchase or billing.
    #[tracing::instrument(skip(self), err)]
    pub async fn retry(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        let computer = self.team_computer(team_id, computer_id).await?;
        if !matches!(computer.state.phase, Phase::Failed { .. }) {
            return Err(ComputerError::NotFailed);
        }
        let computer = self
            .repo
            .apply(computer_id, Event::OperatorRetry, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        Ok(computer.status())
    }

    /// Stop billing at the end of the current period; undo is allowed until then.
    #[tracing::instrument(skip(self), err)]
    pub async fn cancel(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        let computer = self.team_computer(team_id, computer_id).await?;
        let at = if computer.state.payment == crate::domain::lifecycle::PaymentOutcome::Comped {
            self.clock.now()
        } else {
            self.billing.period_end(team_id).await?
        };
        self.apply_for_team(team_id, computer_id, Event::CancelAtPeriodEnd { at })
            .await
    }

    /// Withdraw cancellation before the billing period ends.
    #[tracing::instrument(skip(self), err)]
    pub async fn undo_cancel(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.apply_for_team(team_id, computer_id, Event::UndoCancel)
            .await
    }

    /// Stop billing and destroy the computer now, without a refund. The
    /// caller confirms by typing the computer's name.
    #[tracing::instrument(skip(self, confirm_name), err)]
    pub async fn release_now(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        confirm_name: &str,
    ) -> Result<ComputerStatus, ComputerError> {
        let computer = self.team_computer(team_id, computer_id).await?;
        if confirm_name.trim() != computer.name.as_str() {
            return Err(ComputerError::ConfirmationMismatch);
        }
        self.apply_for_team(team_id, computer_id, Event::ReleaseNow)
            .await
    }

    /// Ask to hear when a sold-out size is back.
    #[tracing::instrument(skip(self), err)]
    pub async fn notify_me(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
        size: ComputerSize,
    ) -> Result<(), ComputerError> {
        self.repo
            .request_notify(team_id, user_id, size)
            .await
            .map_err(internal)
    }

    /// Reconcile a complete subscription snapshot against saved purchase prices.
    /// Keep the oldest computers for each paid item; cancel only its excess rows.
    #[tracing::instrument(skip(self, items), err)]
    pub async fn reconcile_billed_counts(
        &self,
        team_id: Uuid,
        items: &[crate::domain::models::SubscriptionItem],
    ) -> Result<(), ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        let mut paid: Vec<&Computer> = computers
            .iter()
            .filter_map(ComputerRecord::healthy)
            .filter(|computer| computer.is_billed())
            .collect();
        paid.sort_by_key(|computer| computer.created_at);
        let mut remaining = std::collections::BTreeMap::<&str, u64>::new();
        for item in items {
            *remaining.entry(item.price_id.as_str()).or_default() += u64::from(item.quantity);
        }
        for computer in paid {
            let price_id = computer.price_id.as_ref().ok_or_else(|| {
                ComputerError::BadRequest("paid computer has no price id".to_owned())
            })?;
            let quantity = remaining.entry(price_id.as_str()).or_default();
            if *quantity > 0 {
                *quantity -= 1;
            } else {
                tracing::warn!(computer_id = %computer.id, "subscription item removed outside Macro");
                self.repo
                    .apply(computer.id, Event::SubscriptionCanceled, self.clock.now())
                    .await
                    .map_err(internal)?;
            }
        }
        Ok(())
    }

    /// Carry out due billing effects. One failing effect is retried later
    /// and never blocks the others.
    #[tracing::instrument(skip(self), err)]
    pub async fn run_billing_effects(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let effects = self
            .repo
            .lease_effects(
                EffectWorker::Billing,
                BILLING_BATCH,
                now,
                now + chrono::Duration::minutes(2),
            )
            .await
            .map_err(internal)?;
        let count = effects.len();

        for pending in effects {
            let confirming_payment = matches!(pending.effect, Effect::ConfirmPayment { .. });
            let outcome = match pending.effect {
                Effect::ConfirmPayment { extra_items } => {
                    match self
                        .confirm_payment(pending.computer_id, &extra_items)
                        .await
                    {
                        Err(ComputerError::Billing(
                            BillingError::NotAvailable
                            | BillingError::PaymentFailed
                            | BillingError::NoSubscription
                            | BillingError::IntervalNotSold(_),
                        )) => Ok(()),
                        outcome => outcome,
                    }
                }
                Effect::RemoveBillingItem => {
                    self.remove_item(pending.computer_id, pending.id).await
                }
                other => Err(ComputerError::BadRequest(format!(
                    "{other:?} is not a billing effect"
                ))),
            };
            match outcome {
                Ok(()) => self
                    .repo
                    .complete_effect(pending.id)
                    .await
                    .map_err(internal)?,
                Err(error) => {
                    tracing::warn!(effect_id = pending.id, error = ?error, "billing effect failed");
                    if confirming_payment && pending.attempts >= 10 {
                        tracing::error!(computer_id = %pending.computer_id, effect_id = pending.id, attempts = pending.attempts, error = ?error, "computer payment unresolved");
                    }
                    let backoff = chrono::Duration::seconds(
                        30 * i64::from(pending.attempts.saturating_add(1).min(120)),
                    );
                    self.repo
                        .retry_effect(pending.id, error.to_string(), now + backoff)
                        .await
                        .map_err(internal)?;
                }
            }
        }
        Ok(count)
    }

    #[tracing::instrument(skip(self, extra_items), fields(comped), err)]
    async fn confirm_payment(
        &self,
        computer_id: ComputerId,
        extra_items: &[crate::domain::models::SubscriptionItem],
    ) -> Result<(), ComputerError> {
        let _payment = self
            .repo
            .lock_payment(computer_id)
            .await
            .map_err(internal)?;
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(internal)?;
        if matches!(computer.state.phase, Phase::PaymentFailed) {
            return Err(BillingError::PaymentFailed.into());
        }
        if !matches!(computer.state.phase, Phase::PendingPayment { .. }) {
            return Ok(());
        }
        tracing::Span::current().record("comped", computer.state.comp_reason.is_some());
        if let Some(reason) = computer.state.comp_reason {
            self.repo
                .apply(computer_id, Event::Comped { reason }, self.clock.now())
                .await
                .map_err(internal)?
                .ok_or(ComputerError::NotFound)?;
            return Ok(());
        }
        let event = match self
            .billing
            .add_computer(
                computer.team_id,
                computer.price_id.as_ref().ok_or_else(|| {
                    ComputerError::BadRequest("paid computer has no price id".to_owned())
                })?,
                extra_items,
                &format!("computer-add:{computer_id}"),
            )
            .await
        {
            Ok(()) => Event::PaymentConfirmed,
            Err(error @ BillingError::Provider(_)) => return Err(error.into()),
            Err(error) => {
                self.repo
                    .apply(computer_id, Event::PurchaseFailed, self.clock.now())
                    .await
                    .map_err(internal)?;
                return Err(error.into());
            }
        };
        self.repo
            .apply(computer_id, event, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        Ok(())
    }

    async fn remove_item(
        &self,
        computer_id: ComputerId,
        effect_id: i64,
    ) -> Result<(), ComputerError> {
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(internal)?;
        if computer.state.payment != crate::domain::lifecycle::PaymentOutcome::Paid {
            return Ok(());
        }
        // One removal per outbox row: a retry after a lost response is a no-op.
        self.billing
            .remove_computer(
                computer.team_id,
                computer.price_id.as_ref().ok_or_else(|| {
                    ComputerError::BadRequest("paid computer has no price id".to_owned())
                })?,
                &format!("computer-remove:{effect_id}"),
            )
            .await?;
        Ok(())
    }

    async fn team_record(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerRecord, ComputerError> {
        self.repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .filter(|computer| computer.team_id() == team_id)
            .ok_or(ComputerError::NotFound)
    }

    async fn team_computer(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Computer, ComputerError> {
        self.team_record(team_id, computer_id)
            .await?
            .into_healthy()
            .map_err(|_| {
                ComputerError::BadRequest("computer needs attention; contact support".to_owned())
            })
    }

    async fn apply_for_team(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        event: Event,
    ) -> Result<ComputerStatus, ComputerError> {
        self.team_computer(team_id, computer_id).await?;
        let computer = self
            .repo
            .apply(computer_id, event, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        Ok(computer.status())
    }
}

impl Computer {
    /// Whether the team subscription currently carries this computer's item.
    pub fn is_billed(&self) -> bool {
        use crate::domain::lifecycle::Billing;

        self.state.payment == crate::domain::lifecycle::PaymentOutcome::Paid
            && !matches!(
                self.state.phase,
                Phase::PendingPayment { .. } | Phase::PaymentFailed | Phase::Destroyed
            )
            && !matches!(self.state.billing, Billing::Canceled { .. })
    }
}

fn computer_name(request: &PurchaseRequest) -> Result<ComputerName, ComputerError> {
    let name = request
        .name
        .as_deref()
        .or(request
            .persona
            .as_ref()
            .map(|persona| persona.name.as_str()))
        .unwrap_or(DEFAULT_NAME)
        .trim();
    ComputerName::try_new(name).map_err(|error| ComputerError::BadRequest(error.to_string()))
}

/// Reject empty commands and multiline persona values before purchase.
pub fn validate_persona(persona: &Persona) -> Result<(), ComputerError> {
    if persona.extra_service.exec.trim().is_empty() {
        return Err(ComputerError::BadRequest(
            "persona exec must not be empty".to_owned(),
        ));
    }
    for key in persona
        .config
        .keys()
        .chain(persona.extra_service.env.keys())
    {
        key.validate_non_secret()
            .map_err(|error| ComputerError::BadRequest(error.to_string()))?;
    }
    let values = persona
        .config
        .values()
        .chain(persona.extra_service.env.values());
    for value in values {
        if value.contains(['\n', '\r']) {
            return Err(ComputerError::BadRequest(
                "persona values must be single lines".to_owned(),
            ));
        }
    }
    Ok(())
}
