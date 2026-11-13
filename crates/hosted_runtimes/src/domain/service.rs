//! The team-facing computer service: buy, quote, read, power, retry, cancel,
//! restore and release. It runs where Stripe lives (authentication_service),
//! so it is also the one owner of computer billing: it confirms purchases,
//! carries out billing effects and decides what a subscription change means
//! for each computer ([`ComputerService::observe_subscription`]).

use macro_user_id::user_id::MacroUserIdStr;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{Event, Rejected};
use crate::domain::models::{
    Computer, ComputerName, ComputerRecord, ComputerStatus, FleetUnavailable, InvalidComputerName,
    PurchaseBilling, Quote, Reservation, SizeOffer,
};
use crate::domain::ports::{
    Applied, Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, NoComps,
};
use crate::domain::size::ComputerSize;

mod billing;
pub use billing::{ObservedItem, SubscriptionObserved, SubscriptionStatus};
mod purchase;
pub use purchase::{CONFIRM_DELAY, RESERVATION_TTL};
mod team_release;
pub use team_release::TeamComputerRelease;

#[cfg(test)]
pub(crate) mod test;

/// Errors from the computer service.
#[derive(Debug, thiserror::Error)]
pub enum ComputerError {
    /// No fleet operator is currently attached.
    #[error(transparent)]
    FleetUnavailable(#[from] FleetUnavailable),
    /// No computer exists for this team and identity.
    #[error("computer not found")]
    NotFound,
    /// The purchase is still being confirmed; the computer does not exist yet.
    #[error("this computer's purchase is still being confirmed")]
    NotPurchased,
    /// The caller is outside the computer rollout.
    #[error("Macro computers are not enabled for this user")]
    RolloutDisabled,
    /// No host has enough sale capacity for this size.
    #[error("No capacity for {} right now", .0.label())]
    SoldOut(ComputerSize),
    /// The catalog does not offer this size.
    #[error("size is not offered")]
    SizeNotOffered,
    /// The display name is empty or too long.
    #[error(transparent)]
    InvalidName(#[from] InvalidComputerName),
    /// Comped purchases cannot carry subscription items.
    #[error("comped purchases cannot add subscription items")]
    CompedExtraItems,
    /// The team already has a bought computer whose charge has not settled;
    /// it buys the next once that one is paid for (or released).
    #[error("another computer's payment is still being confirmed; try again in a minute")]
    UnpaidComputer,
    /// The purchase key belongs to another team's or another size's purchase.
    #[error("this purchase key was used for a different purchase")]
    PurchaseKeyConflict,
    /// Stored data requires operator repair.
    #[error("computer needs attention; contact support")]
    NeedsAttention,
    /// The lifecycle refused the request in the computer's current state.
    #[error(transparent)]
    Rejected(#[from] Rejected),
    /// The request could not be read (an invalid principal or identifier).
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

impl ComputerError {
    /// True when storage could not be reached at all
    /// ([`crate::domain::ports::StorageUnavailable`]): the work is retried on
    /// the next pass, not counted as a failed attempt or logged as an error.
    pub fn is_storage_unavailable(&self) -> bool {
        let Self::Internal(report) = self else {
            return false;
        };
        report.iter_reports().any(|node| {
            node.downcast_current_context::<crate::domain::ports::StorageUnavailable>()
                .is_some()
                || std::iter::successors(node.current_context_error_source(), |error| {
                    error.source()
                })
                .any(|error| error.is::<crate::domain::ports::StorageUnavailable>())
        })
    }
}

impl From<rootcause::Report> for ComputerError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

pub(crate) fn internal<Err: std::error::Error + Send + Sync + 'static>(
    error: Err,
) -> ComputerError {
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
pub struct ComputerService<Repo, Bill, Time, Attachment, Policy = NoComps> {
    rollout: crate::domain::rollout::ComputerRollout,
    comp_policy: Policy,
    catalog: Vec<crate::domain::size::CatalogEntry>,
    repo: Repo,
    billing: Bill,
    clock: Time,
    attachment: Attachment,
}

impl<Repo, Bill, Time, Attachment> ComputerService<Repo, Bill, Time, Attachment>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
{
    /// Compose the repository, billing provider, clock and attachment source.
    pub fn new(repo: Repo, billing: Bill, clock: Time, attachment: Attachment) -> Self {
        Self {
            rollout: Default::default(),
            comp_policy: NoComps,
            catalog: crate::domain::size::current_catalog(),
            repo,
            billing,
            clock,
            attachment,
        }
    }

    /// Replace the default policy at the composition root.
    pub fn with_comp_policy<Policy: CompPolicy>(
        self,
        comp_policy: Policy,
    ) -> ComputerService<Repo, Bill, Time, Attachment, Policy> {
        ComputerService {
            rollout: self.rollout,
            repo: self.repo,
            billing: self.billing,
            clock: self.clock,
            attachment: self.attachment,
            comp_policy,
            catalog: self.catalog,
        }
    }
}

impl<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
> ComputerService<Repo, Bill, Time, Attachment, Policy>
{
    /// Fleet attachment gate that HTTP-facing use cases run first.
    ///
    /// Callers outside this crate, including `team_agents` discovery, use this
    /// before any repository read. Detached fleets return
    /// [`ComputerError::FleetUnavailable`]; source failures return
    /// [`ComputerError::Internal`].
    pub async fn require_attached(&self) -> Result<(), ComputerError> {
        self.attachment
            .attachment(self.clock.now())
            .await
            .map_err(internal)?
            .require_attached()?;
        Ok(())
    }

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
            .ok_or(ComputerError::SizeNotOffered)
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

    /// The price of one computer of `size` for the team.
    #[tracing::instrument(skip(self, billing), err)]
    async fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
        billing: &PurchaseBilling,
    ) -> Result<Quote, ComputerError> {
        self.require_attached().await?;
        self.size_spec(size)?;
        if let PurchaseBilling::Stripe = billing {
            self.billing.require_paid_plan(team_id).await?;
        }
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

    /// Every size some host can run awake, with its price and availability.
    /// A size too large for every host is left out rather than sold out:
    /// waiting for capacity would never make it available.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn offers(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<SizeOffer>, ComputerError> {
        self.require_rollout(&user_id).await?;
        self.require_attached().await?;
        let hosts = self.repo.allocation().await.map_err(internal)?;

        let billing = self.purchase_billing(team_id).await?;
        let mut offers = Vec::new();
        for entry in &self.catalog {
            let size = entry.size;
            let units = entry.resources.units();
            if !hosts.iter().any(|host| host.runs(units)) {
                continue;
            }
            offers.push(SizeOffer {
                size,
                vcpus: entry.resources.vcpus.get(),
                memory_gb: entry.resources.memory_gib.get(),
                disk_gb: entry.resources.disk_gib.get(),
                quote: self.quote(team_id, size, &billing).await?,
                sold_out: !hosts.iter().any(|host| host.sells(units)),
            });
        }
        Ok(offers)
    }

    /// One of the team's computers, or its purchase while it is being
    /// confirmed. Tests read single computers through it; no route does.
    #[cfg(test)]
    pub(crate) async fn status(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        match self.team_record(team_id, computer_id).await {
            Ok(record) => self.status_of(&record).await,
            Err(ComputerError::NotPurchased) => Ok(self
                .team_reservation(team_id, computer_id)
                .await?
                .ok_or(ComputerError::NotFound)?
                .status()),
            Err(error) => Err(error),
        }
    }

    /// The team's computers and purchases being confirmed, oldest first. Not
    /// gated on an attached fleet: every team member's Settings lists them,
    /// and a team without any must see an empty list rather than an outage.
    #[tracing::instrument(skip(self), err)]
    pub async fn list(&self, team_id: Uuid) -> Result<Vec<ComputerStatus>, ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        let reservations = self
            .repo
            .team_reservations(team_id)
            .await
            .map_err(internal)?;
        let ids: Vec<ComputerId> = computers.iter().map(ComputerRecord::id).collect();
        let counts = self.repo.agent_counts(&ids).await.map_err(internal)?;
        let now = self.clock.now();
        let policy = self.repo.policy();
        let mut statuses: Vec<ComputerStatus> = computers
            .iter()
            .map(|computer| {
                computer.status(
                    counts.get(&computer.id()).copied().unwrap_or(0),
                    now,
                    policy,
                )
            })
            .chain(reservations.iter().map(Reservation::status))
            .collect();
        statuses.sort_by_key(|status| status.created_at);
        Ok(statuses)
    }

    /// Apply the team-requested power state.
    #[tracing::instrument(skip(self), err)]
    pub async fn set_power(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        on: bool,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        let event = if on { Event::PowerOn } else { Event::PowerOff };
        self.apply_for_team(team_id, computer_id, event).await
    }

    /// Retry a computer that gave up restarting, without changing its billing.
    #[tracing::instrument(skip(self), err)]
    pub async fn retry(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        self.apply_for_team(team_id, computer_id, Event::TeamRetry)
            .await
    }

    /// Record that the team finished the guided setup after buying the
    /// computer. Idempotent: the first time is kept. Callers authorize the
    /// team's owner or an admin, who manage its Claude Code sign-in too.
    #[tracing::instrument(skip(self), err)]
    pub async fn complete_setup(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        self.team_computer(team_id, computer_id).await?;

        let computer = self
            .repo
            .complete_setup(computer_id, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        self.status_of(&computer).await
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
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        if confirm_name.trim() != computer.name.as_str() {
            return Err(ComputerError::ConfirmationMismatch);
        }
        self.apply_for_team(team_id, computer_id, Event::ReleaseNow)
            .await
    }

    /// A computer's status, with the agents bound to its harness counted.
    async fn status_of(&self, record: &ComputerRecord) -> Result<ComputerStatus, ComputerError> {
        let counts = self
            .repo
            .agent_counts(&[record.id()])
            .await
            .map_err(internal)?;
        Ok(record.status(
            counts.get(&record.id()).copied().unwrap_or(0),
            self.clock.now(),
            self.repo.policy(),
        ))
    }

    async fn team_reservation(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<Reservation>, ComputerError> {
        Ok(self
            .repo
            .reservation(computer_id)
            .await
            .map_err(internal)?
            .filter(|reservation| reservation.team_id == team_id))
    }

    /// The team's computer record; a purchase still being confirmed is
    /// [`ComputerError::NotPurchased`].
    async fn team_record(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerRecord, ComputerError> {
        if let Some(record) = self
            .repo
            .get(computer_id)
            .await
            .map_err(internal)?
            .filter(|computer| computer.team_id() == team_id)
        {
            return Ok(record);
        }
        match self.team_reservation(team_id, computer_id).await? {
            Some(_) => Err(ComputerError::NotPurchased),
            None => Err(ComputerError::NotFound),
        }
    }

    async fn team_computer(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Computer, ComputerError> {
        self.team_record(team_id, computer_id)
            .await?
            .into_healthy()
            .map_err(|_| ComputerError::NeedsAttention)
    }

    /// Apply a request to one of the team's computers; the lifecycle decides
    /// whether it applies.
    async fn apply_for_team(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        event: Event,
    ) -> Result<ComputerStatus, ComputerError> {
        self.team_computer(team_id, computer_id).await?;
        let computer = self.apply(computer_id, event).await?;
        self.status_of(&computer.into()).await
    }

    /// Apply an event, mapping a lifecycle rejection to its typed error.
    async fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
    ) -> Result<Computer, ComputerError> {
        match self
            .repo
            .apply(computer_id, event, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
        {
            Applied::Changed(computer) => Ok(*computer),
            Applied::Rejected(rejected) => Err(rejected.into()),
        }
    }
}

fn computer_name(name: Option<&str>) -> Result<ComputerName, ComputerError> {
    const DEFAULT_NAME: &str = "Macro computer";
    Ok(ComputerName::try_new(name.unwrap_or(DEFAULT_NAME))?)
}
