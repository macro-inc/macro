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
    PurchaseBilling, Quote, Reservation, RosterComputerStatus, SizeOffer,
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
    /// No host has enough sale capacity.
    #[error("this size is sold out")]
    SoldOut,
    /// The catalog does not offer this size.
    #[error("size is not offered")]
    SizeNotOffered,
    /// The display name is empty or too long.
    #[error(transparent)]
    InvalidName(#[from] InvalidComputerName),
    /// Comped purchases cannot carry subscription items.
    #[error("comped purchases cannot add subscription items")]
    CompedExtraItems,
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
    /// The caller's team role does not allow this.
    #[error("only the computer's buyer or the team owner can do this")]
    Forbidden,
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

pub(crate) fn internal<Err: std::error::Error + Send + Sync + 'static>(
    error: Err,
) -> ComputerError {
    ComputerError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// The caller's role, as far as managing a computer's setup goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamMemberRole {
    /// The team's owner.
    Owner,
    /// Any other member, including admins.
    Other,
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

    /// Team-agent lifecycle maintenance, independent of HTTP availability gates.
    pub fn maintenance(&self) -> ComputerMaintenance<'_> {
        ComputerMaintenance { service: self }
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

    /// Quote using server-side team policy.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn quote_for_team(
        &self,
        user_id: &MacroUserIdStr<'static>,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<Quote, ComputerError> {
        self.require_rollout(user_id).await?;
        self.require_attached().await?;
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

    /// Every size with its price and availability.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn offers(
        &self,
        team_id: Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<SizeOffer>, ComputerError> {
        self.require_rollout(&user_id).await?;
        self.require_attached().await?;
        let sold_out = self
            .repo
            .sold_out_sizes(&self.catalog, self.clock.now())
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
            });
        }
        Ok(offers)
    }

    /// One of the team's computers, or its purchase while it is being confirmed.
    #[tracing::instrument(skip(self), err)]
    pub async fn status(
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
        self.apply_for_team(team_id, computer_id, Event::OperatorRetry)
            .await
    }

    /// Record that the team finished the guided setup after buying the
    /// computer. Idempotent: the first time is kept. Allowed to whoever may
    /// manage the computer's Claude Code sign-in, its buyer or the team owner.
    #[tracing::instrument(skip(self), err)]
    pub async fn complete_setup(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        caller: MacroUserIdStr<'static>,
        caller_role: TeamMemberRole,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        let allowed = match caller_role {
            TeamMemberRole::Owner => true,
            TeamMemberRole::Other => computer.created_by == caller,
        };
        if !allowed {
            return Err(ComputerError::Forbidden);
        }

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

/// Team-agent maintenance only; no HTTP route exposes this capability.
pub struct ComputerMaintenance<'a> {
    service: &'a dyn MaintenanceOperations,
}

type MaintenanceFuture<'a, T> =
    std::pin::Pin<Box<dyn Future<Output = Result<T, ComputerError>> + Send + 'a>>;

trait MaintenanceOperations: Sync {
    fn status_for_roster(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> MaintenanceFuture<'_, RosterComputerStatus>;
    fn request_release(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> MaintenanceFuture<'_, ComputerStatus>;
}

impl ComputerMaintenance<'_> {
    /// Read durable roster status without refusing a detached fleet.
    #[tracing::instrument(skip(self), err)]
    pub async fn status_for_roster(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<RosterComputerStatus, ComputerError> {
        self.service.status_for_roster(team_id, computer_id).await
    }

    /// Queue release through the lifecycle without fleet access or name confirmation.
    #[tracing::instrument(skip(self), err)]
    pub async fn request_release(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.service.request_release(team_id, computer_id).await
    }
}

impl<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
> MaintenanceOperations for ComputerService<Repo, Bill, Time, Attachment, Policy>
{
    fn status_for_roster(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> MaintenanceFuture<'_, RosterComputerStatus> {
        Box::pin(async move {
            let availability = self
                .attachment
                .attachment(self.clock.now())
                .await
                .map_err(internal)?;
            let record = self.team_record(team_id, computer_id).await?;
            let status = self.status_of(&record).await?;
            Ok(RosterComputerStatus {
                status,
                availability,
            })
        })
    }

    fn request_release(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> MaintenanceFuture<'_, ComputerStatus> {
        Box::pin(self.apply_for_team(team_id, computer_id, Event::ReleaseNow))
    }
}

fn computer_name(name: Option<&str>) -> Result<ComputerName, ComputerError> {
    const DEFAULT_NAME: &str = "Macro computer";
    Ok(ComputerName::try_new(name.unwrap_or(DEFAULT_NAME))?)
}
