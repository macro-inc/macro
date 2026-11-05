//! The team-facing computer service: buy, quote, read, power, retry, cancel and
//! release. It runs where Stripe lives (authentication_service), so it also
//! carries out billing effects.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::lifecycle::{Effect, EffectWorker, Event, Phase};
use crate::domain::models::{
    Computer, ComputerStatus, NewComputer, PurchaseBilling, PurchaseRequest, Quote, SizeOffer,
};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, NoComps, ReserveError,
};
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

const MAX_NAME_CHARS: usize = 64;
const DEFAULT_NAME: &str = "Macro computer";
/// Billing effects leased per worker pass.
const BILLING_BATCH: u32 = 16;

/// Errors from the computer service.
#[derive(Debug, thiserror::Error)]
pub enum ComputerError {
    #[error("computer not found")]
    NotFound,
    #[error("only a failed computer can be retried")]
    NotFailed,
    #[error("this size is sold out")]
    SoldOut,
    #[error("{0}")]
    BadRequest(String),
    #[error("type the computer's name to release it")]
    ConfirmationMismatch,
    #[error(transparent)]
    Billing(#[from] BillingError),
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
    comp_policy: Policy,
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
    pub fn new(repo: Repo, billing: Bill, clock: Time) -> Self {
        Self {
            comp_policy: NoComps,
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
            repo: self.repo,
            billing: self.billing,
            clock: self.clock,
            comp_policy,
        }
    }
}

impl<Repo: ComputerRepo, Bill: Billing, Time: Clock, Policy: CompPolicy>
    ComputerService<Repo, Bill, Time, Policy>
{
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
    ) -> Result<Uuid, ComputerError> {
        request.billing = self.purchase_billing(request.team_id).await?;
        self.purchase(request).await
    }

    /// Quote using server-side team policy.
    pub async fn quote_for_team(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<Quote, ComputerError> {
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
        let quote = self.billing.quote(team_id, size).await;
        match billing {
            PurchaseBilling::Stripe => Ok(quote?),
            PurchaseBilling::Comped { .. } => {
                let mut quote = match quote {
                    Ok(quote) => quote,
                    Err(BillingError::NoSubscription) => Quote {
                        size,
                        price_id: String::new(),
                        amount: 0,
                        currency: "usd".to_owned(),
                        interval: crate::domain::models::BillingInterval::Month,
                    },
                    Err(error) => return Err(error.into()),
                };
                quote.amount = 0;
                Ok(quote)
            }
        }
    }

    /// Every size with its price, availability and the caller's notify requests.
    #[tracing::instrument(skip(self), err)]
    pub async fn offers(
        &self,
        team_id: Uuid,
        user_id: String,
    ) -> Result<Vec<SizeOffer>, ComputerError> {
        let sold_out = self.repo.sold_out_sizes().await.map_err(internal)?;
        let notify = self
            .repo
            .notify_requests(team_id, user_id)
            .await
            .map_err(internal)?;

        let billing = self.purchase_billing(team_id).await?;
        let mut offers = Vec::new();
        for size in ComputerSize::ALL {
            offers.push(SizeOffer {
                size,
                vcpus: size.vcpus(),
                memory_gb: size.memory_gb(),
                disk_gb: size.disk_gb(),
                quote: self.quote(team_id, size, &billing).await?,
                sold_out: sold_out.contains(&size),
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
        fields(team_id = %request.team_id, size = request.size.as_ref(), computer_id, billing_kind, comped = matches!(&request.billing, PurchaseBilling::Comped { .. })),
        err
    )]
    pub async fn purchase(&self, request: PurchaseRequest) -> Result<Uuid, ComputerError> {
        tracing::Span::current().record(
            "billing_kind",
            if matches!(request.billing, PurchaseBilling::Comped { .. }) {
                "comped"
            } else {
                "stripe"
            },
        );
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
        let computer_id = Uuid::now_v7();
        tracing::Span::current().record("computer_id", tracing::field::display(computer_id));

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

        self.confirm_payment(computer_id, &request.extra_items)
            .await?;

        Ok(computer_id)
    }

    /// One of the team's computers.
    #[tracing::instrument(skip(self), err)]
    pub async fn status(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> Result<ComputerStatus, ComputerError> {
        Ok(self.team_computer(team_id, computer_id).await?.status())
    }

    /// The team's computers, oldest first.
    #[tracing::instrument(skip(self), err)]
    pub async fn list(&self, team_id: Uuid) -> Result<Vec<ComputerStatus>, ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        Ok(computers.iter().map(Computer::status).collect())
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn set_power(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
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
        computer_id: Uuid,
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
        computer_id: Uuid,
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

    #[tracing::instrument(skip(self), err)]
    pub async fn undo_cancel(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
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
        computer_id: Uuid,
        confirm_name: &str,
    ) -> Result<ComputerStatus, ComputerError> {
        let computer = self.team_computer(team_id, computer_id).await?;
        if confirm_name.trim() != computer.name {
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
        user_id: String,
        size: ComputerSize,
    ) -> Result<(), ComputerError> {
        self.repo
            .request_notify(team_id, user_id, size)
            .await
            .map_err(internal)
    }

    /// The team subscription lost computer items outside our timers (a
    /// webhook saw fewer than we bill): cancel the newest computers of that
    /// size until the counts match.
    #[tracing::instrument(skip(self), err)]
    pub async fn reconcile_billed_count(
        &self,
        team_id: Uuid,
        size: ComputerSize,
        billed: u32,
    ) -> Result<(), ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        let mut paid: Vec<&Computer> = computers
            .iter()
            .filter(|computer| computer.size == size && computer.is_billed())
            .collect();
        paid.sort_by_key(|computer| computer.created_at);

        if billed as usize > paid.len() {
            tracing::error!(
                team_id = %team_id,
                size = size.as_ref(),
                billed,
                computers = paid.len(),
                "team billed for more computers than it has"
            );
        }
        let excess = paid.len().saturating_sub(billed as usize);
        for computer in paid.iter().rev().take(excess) {
            tracing::warn!(computer_id = %computer.id, "subscription item removed outside Macro");
            self.repo
                .apply(computer.id, Event::SubscriptionCanceled, self.clock.now())
                .await
                .map_err(internal)?;
        }
        Ok(())
    }

    /// Carry out due billing effects. One failing effect is retried later
    /// and never blocks the others.
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
            use tracing::Instrument;
            let span = tracing::info_span!("computer.billing.effect", computer_id = %pending.computer_id, effect_id = pending.id, attempts = i64::from(pending.attempts), otel.status_code = tracing::field::Empty);
            let computer = self
                .repo
                .get(pending.computer_id)
                .await
                .inspect_err(|_| {
                    span.record("otel.status_code", "ERROR");
                })
                .map_err(internal)?;
            super::telemetry::attach(
                &span,
                computer
                    .as_ref()
                    .and_then(|computer| computer.state.provision_traceparent.as_deref()),
            );
            async {
            let confirming_payment = matches!(pending.effect, Effect::ConfirmPayment { .. });
            let outcome = match pending.effect {
                Effect::ConfirmPayment { extra_items } => {
                    match self
                        .confirm_payment(pending.computer_id, &extra_items)
                        .await
                    {
                        Err(ComputerError::Billing(
                            BillingError::PaymentFailed
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
                    super::telemetry::effect_failed("billing");
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
            Ok::<(), ComputerError>(())
            }.instrument(span.clone()).await.inspect_err(|_| { span.record("otel.status_code", "ERROR"); })?;
        }
        Ok(count)
    }

    #[tracing::instrument(skip(self, extra_items), fields(comped), err)]
    async fn confirm_payment(
        &self,
        computer_id: Uuid,
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
            .ok_or(ComputerError::NotFound)?;
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
                computer.size,
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

    async fn remove_item(&self, computer_id: Uuid, effect_id: i64) -> Result<(), ComputerError> {
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        if computer.state.payment != crate::domain::lifecycle::PaymentOutcome::Paid {
            return Ok(());
        }
        // One removal per outbox row: a retry after a lost response is a no-op.
        self.billing
            .remove_computer(
                computer.team_id,
                computer.size,
                &format!("computer-remove:{effect_id}"),
            )
            .await?;
        Ok(())
    }

    async fn team_computer(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> Result<Computer, ComputerError> {
        self.repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .filter(|computer| computer.team_id == team_id)
            .ok_or(ComputerError::NotFound)
    }

    async fn apply_for_team(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
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

fn computer_name(request: &PurchaseRequest) -> Result<String, ComputerError> {
    let name = request
        .name
        .as_deref()
        .or(request
            .persona
            .as_ref()
            .map(|persona| persona.name.as_str()))
        .unwrap_or(DEFAULT_NAME)
        .trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(ComputerError::BadRequest(format!(
            "name must be 1..={MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

/// Reject personas the computer could not install: the OS user and unit
/// name become paths and systemd names on the guest.
pub fn validate_persona(persona: &Persona) -> Result<(), ComputerError> {
    let reserved_users = ["root", "macro", "macrod"];
    if !lazy_regex::regex_is_match!(r"^[a-z_][a-z0-9_-]{0,30}$", &persona.os_user)
        || reserved_users.contains(&persona.os_user.as_str())
    {
        return Err(ComputerError::BadRequest(
            "persona os_user must be a new lowercase Linux user name".to_owned(),
        ));
    }
    if !lazy_regex::regex_is_match!(r"^[A-Za-z0-9_.@-]{1,64}$", &persona.extra_service.unit_name)
        || persona.extra_service.unit_name.starts_with("macrod")
    {
        return Err(ComputerError::BadRequest(
            "persona unit_name must be a plain systemd unit name".to_owned(),
        ));
    }
    if persona.extra_service.exec.trim().is_empty() {
        return Err(ComputerError::BadRequest(
            "persona exec must not be empty".to_owned(),
        ));
    }
    let env_keys = persona
        .config
        .keys()
        .chain(persona.extra_service.env.keys());
    for key in env_keys {
        if !lazy_regex::regex_is_match!(r"^[A-Za-z_][A-Za-z0-9_]*$", key) {
            return Err(ComputerError::BadRequest(format!(
                "persona variable {key:?} is not a valid environment name"
            )));
        }
    }
    let values = persona
        .config
        .values()
        .chain(persona.extra_service.env.values());
    for value in values {
        if value.contains('\n') {
            return Err(ComputerError::BadRequest(
                "persona values must be single lines".to_owned(),
            ));
        }
    }
    Ok(())
}
