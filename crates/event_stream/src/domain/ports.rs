//! Ports the event stream domain needs from the outside.

use crate::domain::models::{Cursor, LogEntry, LogRecord};
use event_exposure::{EntityType, MinAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::future::Future;
use uuid::Uuid;

/// The shared, short-retention log of public events.
pub trait EventLog: Send + Sync + 'static {
    /// Append one record; returns its cursor. Carries the current trace.
    fn append(&self, record: &LogRecord) -> impl Future<Output = Result<Cursor, Report>> + Send;

    /// Up to `count` raw entries strictly after `after`, oldest first, of
    /// which those this version can read are returned.
    fn read_after(
        &self,
        after: Cursor,
        count: usize,
    ) -> impl Future<Output = Result<LogPage, Report>> + Send;

    /// The oldest cursor the log still guarantees: every entry at or after
    /// it is retained.
    fn retained_floor(&self) -> impl Future<Output = Result<Cursor, Report>> + Send;
}

/// One page of the log.
#[derive(Debug, Default)]
pub struct LogPage {
    /// The readable entries.
    pub entries: Vec<LogEntry>,
    /// The cursor of the last raw entry read, readable or not: where the
    /// next page starts.
    pub last: Option<Cursor>,
    /// Whether the page was full, so more may follow.
    pub full: bool,
}

/// A process' tail of the log, from the moment it started.
pub trait LogTail: Send + 'static {
    /// The next entry. Blocks until one is appended.
    fn next(&mut self) -> impl Future<Output = Result<TailItem, Report>> + Send;
}

/// What a tail read produced.
#[derive(Debug)]
pub enum TailItem {
    /// The next entry.
    Entry(Box<LogEntry>),
    /// The tail lost its place: entries were trimmed before it read them
    /// (Redis was unreachable for longer than the retention). Every stream
    /// has missed events it cannot replay.
    Gap,
}

/// Explicit entity accessors: the same set persisted webhooks fan out to.
/// Link-share viewers are never accessors. Implementations read current
/// access with no cache of their own: the domain's cache and its eviction on
/// revocation events are the only staleness allowed.
pub trait AccessDirectory: Send + Sync + 'static {
    /// Every explicit accessor of an entity, as principal ids.
    fn accessors(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, AccessLookupError>> + Send;

    /// Whether one principal is an explicit accessor: the same answer as
    /// membership in [`Self::accessors`], without listing it.
    fn is_accessor(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
    ) -> impl Future<Output = Result<bool, AccessLookupError>> + Send;

    /// Whether one principal is an explicit accessor whose granted level is
    /// at least `min_level`. Link shares never count, as for webhooks.
    fn is_accessor_at_least(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
        min_level: MinAccessLevel,
    ) -> impl Future<Output = Result<bool, AccessLookupError>> + Send;
}

/// Why an access lookup failed.
#[derive(Debug, thiserror::Error)]
pub enum AccessLookupError {
    /// The entity type has no accessor expansion, or its id is malformed:
    /// nobody can be admitted through it.
    #[error("entity has no accessor expansion: {0}")]
    Unsupported(String),
    /// The lookup failed.
    #[error("access lookup failed")]
    Failed(Report),
}

/// A team role, ordered from least to most privileged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TeamRole {
    /// A member.
    Member,
    /// An admin.
    Admin,
    /// The owner.
    Owner,
}

/// Team membership.
pub trait TeamDirectory: Send + Sync + 'static {
    /// Every member of a team with their role.
    fn members(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<(MacroUserIdStr<'static>, TeamRole)>, Report>> + Send;

    /// Every team a user belongs to with their role, most privileged first
    /// (ties by team id), matching how a user's team workspace is chosen.
    fn teams_of(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<(Uuid, TeamRole)>, Report>> + Send;
}

/// Exact contact-graph membership.
pub trait ContactDirectory: Send + Sync + 'static {
    /// Whether `other` is a contact of `user`: one bounded point lookup.
    fn is_contact(
        &self,
        user: &MacroUserIdStr<'static>,
        other: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Per-user evaluation of the `public-event-stream` rollout flag.
pub trait PreviewFlag: Send + Sync + 'static {
    /// Whether the user has the flag. A failed evaluation reads `false`.
    fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> impl Future<Output = bool> + Send;
}

/// Concurrent-stream leases.
pub trait StreamLimiter: Send + Sync + 'static {
    /// Acquire or renew `stream`'s lease on each of `keys`. Returns the first
    /// key whose limit refused it, after releasing what this call acquired.
    fn acquire(
        &self,
        keys: &[LimitKey],
        stream: &str,
    ) -> impl Future<Output = Result<Option<LimitKey>, Report>> + Send;

    /// Renew `stream`'s leases on `keys`. Never releases; returns the keys
    /// whose limit refused the renewal (the lease had lapsed and others took
    /// the slot).
    fn renew(
        &self,
        keys: &[LimitKey],
        stream: &str,
    ) -> impl Future<Output = Result<Vec<LimitKey>, Report>> + Send;

    /// Release `stream`'s leases on `keys`.
    fn release(&self, keys: &[LimitKey], stream: &str) -> impl Future<Output = ()> + Send;
}

/// A concurrent-stream limit a stream counts against.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum LimitKey {
    /// Streams per user (20).
    User(String),
    /// Streams per API key (5); the id is an opaque key digest.
    ApiKey(String),
    /// Streams per bot (5).
    Bot(Uuid),
    /// Streams per harness runtime (5).
    Harness(Uuid),
}

impl LimitKey {
    /// The limit's kind, for telemetry (never the user id or key digest).
    pub fn kind(&self) -> &'static str {
        match self {
            Self::User(_) => "user",
            Self::ApiKey(_) => "api_key",
            Self::Bot(_) => "bot",
            Self::Harness(_) => "harness",
        }
    }

    /// Concurrent streams allowed on this key.
    pub fn max_streams(&self) -> u64 {
        match self {
            Self::User(_) => 20,
            Self::ApiKey(_) | Self::Bot(_) | Self::Harness(_) => 5,
        }
    }
}

/// Re-validates the credential a stream was opened with.
pub trait CredentialCheck: Send + Sync + 'static {
    /// Whether the credential still authenticates the same principal.
    /// `Err` means the check could not run (try again later), not revoked.
    fn still_valid(&self) -> futures::future::BoxFuture<'_, Result<bool, Report>>;
}

/// The Macro owners of a GitHub App installation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstallationOwners {
    /// Users who installed it personally.
    pub users: Vec<MacroUserIdStr<'static>>,
    /// Teams it is installed for.
    pub teams: Vec<Uuid>,
}

/// GitHub App installation claims, by the rule routines use: a user holds a
/// claim when they own the installation (personal, with the installing
/// GitHub account still linked) or belong to an owning team, and have a
/// linked GitHub account.
pub trait GithubClaims: Send + Sync + 'static {
    /// The users and teams an installation is recorded against, before the
    /// claim rule: candidates for [`Self::has_claim`].
    fn installation_owners(
        &self,
        installation_id: &str,
    ) -> impl Future<Output = Result<InstallationOwners, Report>> + Send;

    /// The users among `users` who hold a claim on the installation: the
    /// set form of [`Self::has_claim`], in one read.
    fn claimants(
        &self,
        users: &[MacroUserIdStr<'static>],
        installation_id: &str,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Whether `user` holds a claim on the installation.
    fn has_claim(
        &self,
        user: &MacroUserIdStr<'static>,
        installation_id: &str,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}
