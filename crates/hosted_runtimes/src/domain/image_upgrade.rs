//! Rolling a new guest image onto existing computers (an operator's image
//! upgrade). An upgrade names an immutable image version, its files'
//! digests and where the hosts fetch them, and the exact computers to move.
//! The operator's upgrade pass (`operator::image_upgrade`) then:
//!
//! 1. stages the image on every host of those computers and waits until each
//!    host holds exactly these files ([`UpgradeState::Staging`]);
//! 2. moves computers [`ImageUpgrade::batch_size`] at a time
//!    ([`UpgradeState::Rolling`]): each waits until no one uses it (no agent
//!    turn under way, no screen or shell open), at most until
//!    [`ImageUpgrade::idle_deadline_at`], after which it is skipped, never
//!    forced. An idle one gets a fresh system disk of the image and cold
//!    boots with its own `/home` and identity; it is done once macrod
//!    connects again;
//! 3. on a failed boot, or no macrod within
//!    [`ImageUpgrade::reconnect_timeout`], puts that computer back on its
//!    previous system disk, checks macrod comes back, and pauses the upgrade
//!    ([`UpgradeState::Paused`]): no further computer starts.
//!
//! Every computer's old and new image is recorded on its row here and in
//! `hosted_runtime.image`. While a computer is being replaced or rolled
//! back, the operator holds its fleet effects and reconcile skips it, as for
//! a move.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::image::GuestImage;

#[cfg(test)]
mod test;

/// The most computers an upgrade moves at once.
pub const MAX_BATCH_SIZE: u8 = 5;
/// The most computers one upgrade names.
pub const MAX_COMPUTERS: usize = 50;
/// The longest an upgrade waits for its computers to be idle.
pub const MAX_IDLE_WAIT: Duration = Duration::hours(24);
/// The longest it waits for macrod after a boot.
pub const MAX_RECONNECT_TIMEOUT: Duration = Duration::minutes(30);
/// How long a replica holds an upgrade between passes; the pass renews it.
pub const UPGRADE_LEASE: Duration = Duration::minutes(5);

/// An upgrade's identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UpgradeId(Uuid);

impl UpgradeId {
    /// A new time-ordered id.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }

    /// Wrap a stored id.
    pub const fn new(id: Uuid) -> Self {
        Self(id)
    }

    /// The stored id.
    pub const fn into_inner(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for UpgradeId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// An image version an upgrade may roll out: `<name>/<YYYY-MM-DD><letter>`,
/// e.g. `macro-box/2026-11-24a`. A branch, `latest` or `main` is refused:
/// what such a name holds changes, and an upgrade must name one build.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ImageVersion(GuestImage);

/// Not an immutable image version.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not an image version like macro-box/2026-11-24a")]
pub struct InvalidImageVersion(pub String);

impl ImageVersion {
    /// Check `version`.
    pub fn try_new(version: &str) -> Result<Self, InvalidImageVersion> {
        let invalid = || InvalidImageVersion(version.to_owned());
        let (rest, ()) = image_version(version).map_err(|_| invalid())?;
        if !rest.is_empty() {
            return Err(invalid());
        }
        GuestImage::try_new(version)
            .map(Self)
            .map_err(|_| invalid())
    }

    /// The guest image it names.
    pub fn image(&self) -> &GuestImage {
        &self.0
    }

    /// The version.
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl TryFrom<String> for ImageVersion {
    type Error = InvalidImageVersion;

    fn try_from(version: String) -> Result<Self, Self::Error> {
        Self::try_new(&version)
    }
}

impl From<ImageVersion> for String {
    fn from(version: ImageVersion) -> Self {
        version.0.as_str().to_owned()
    }
}

impl std::fmt::Display for ImageVersion {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// `<name>/<YYYY>-<MM>-<DD><letter>`, the name lowercase letters, digits
/// and `-`.
fn image_version(input: &str) -> nom::IResult<&str, ()> {
    use nom::Parser;
    use nom::bytes::complete::{tag, take_while_m_n, take_while1};
    use nom::character::complete::satisfy;

    let digits = |count| take_while_m_n(count, count, |c: char| c.is_ascii_digit());
    let (rest, (_, _, _, _, _, _, _, _)) = (
        take_while1(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
        tag("/"),
        digits(4),
        tag("-"),
        digits(2),
        tag("-"),
        digits(2),
        satisfy(|c| c.is_ascii_lowercase()),
    )
        .parse(input)?;
    Ok((rest, ()))
}

/// One of an image's files.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumIter,
)]
pub enum ImageFileName {
    /// The kernel.
    #[serde(rename = "vmlinux")]
    #[strum(serialize = "vmlinux")]
    Vmlinux,
    /// The root filesystem.
    #[serde(rename = "rootfs.ext4")]
    #[strum(serialize = "rootfs.ext4")]
    RootfsExt4,
    /// The kernel command line.
    #[serde(rename = "boot_args")]
    #[strum(serialize = "boot_args")]
    BootArgs,
}

/// A SHA-256 as 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Sha256(String);

/// Not 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0:?} is not a SHA-256")]
pub struct InvalidSha256(pub String);

impl Sha256 {
    /// Check `digest`.
    pub fn try_new(digest: &str) -> Result<Self, InvalidSha256> {
        if digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(digest.to_owned()))
        } else {
            Err(InvalidSha256(digest.to_owned()))
        }
    }

    /// The hex digits.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Sha256 {
    type Error = InvalidSha256;

    fn try_from(digest: String) -> Result<Self, Self::Error> {
        Self::try_new(&digest)
    }
}

impl From<Sha256> for String {
    fn from(digest: Sha256) -> Self {
        digest.0
    }
}

/// What one file of the image holds.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ImageFile {
    /// Which file.
    pub name: ImageFileName,
    /// SHA-256 of its contents.
    pub sha256: Sha256,
    /// Its size.
    pub bytes: u64,
}

/// Where a host fetches a file, zstd-compressed. Usually presigned: a
/// credential until it expires, so it is never logged and is dropped once
/// the image is staged.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SourceUrl(String);

impl SourceUrl {
    /// An `https` URL; `None` for anything else.
    pub fn try_new(url: &str) -> Option<Self> {
        url.starts_with("https://").then(|| Self(url.to_owned()))
    }

    /// The URL, for the host.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SourceUrl {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SourceUrl(**redacted**)")
    }
}

/// A file and where to fetch it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageSource {
    /// What it holds.
    pub file: ImageFile,
    /// Where it is.
    pub url: SourceUrl,
}

/// The image's files with digests, sorted by name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "Vec<ImageFile>", into = "Vec<ImageFile>")]
pub struct ImageFiles(Vec<ImageFile>);

/// The files are not each of the three exactly once.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("an image has vmlinux, rootfs.ext4 and boot_args, once each")]
pub struct InvalidImageFiles;

impl ImageFiles {
    /// Check that `files` are the three, once each.
    pub fn try_new(mut files: Vec<ImageFile>) -> Result<Self, InvalidImageFiles> {
        files.sort_by_key(|file| file.name);
        let names: Vec<ImageFileName> = files.iter().map(|file| file.name).collect();
        if names
            != [
                ImageFileName::Vmlinux,
                ImageFileName::RootfsExt4,
                ImageFileName::BootArgs,
            ]
        {
            return Err(InvalidImageFiles);
        }
        Ok(Self(files))
    }

    /// The files, sorted by name.
    pub fn files(&self) -> &[ImageFile] {
        &self.0
    }

    /// Whether a host's `files` are exactly these.
    pub fn held_by(&self, files: &[ImageFile]) -> bool {
        let mut files = files.to_vec();
        files.sort_by_key(|file| file.name);
        files == self.0
    }
}

impl TryFrom<Vec<ImageFile>> for ImageFiles {
    type Error = InvalidImageFiles;

    fn try_from(files: Vec<ImageFile>) -> Result<Self, Self::Error> {
        Self::try_new(files)
    }
}

impl From<ImageFiles> for Vec<ImageFile> {
    fn from(files: ImageFiles) -> Self {
        files.0
    }
}

/// Where an upgrade stands.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::Display,
    strum::EnumString,
)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "image_upgrade_state", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum UpgradeState {
    /// Putting the image on the hosts.
    Staging,
    /// Moving computers.
    Rolling,
    /// A computer failed and was rolled back: no further computer starts.
    /// Computers already under way finish.
    Paused,
    /// Every computer was upgraded or skipped.
    Done,
    /// The image could not be staged; no computer was touched.
    Failed,
}

/// Where one computer of an upgrade stands.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::Display,
    strum::EnumString,
)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "image_upgrade_computer_state", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ComputerUpgradeState {
    /// Not started.
    Waiting,
    /// Its system disk is being replaced.
    Replacing,
    /// On the new image, waiting for macrod.
    Verifying,
    /// Going back to its previous system disk.
    RollingBack,
    /// On the new image with macrod connected; finished.
    Upgraded,
    /// Never idle before the deadline, or not running: left as it was;
    /// finished.
    Skipped,
    /// Back on its previous image with macrod connected; finished.
    RolledBack,
    /// The rollback did not bring macrod back; finished, needs an operator.
    RollbackFailed,
}

impl ComputerUpgradeState {
    /// Whether the computer is between images: its fleet effects wait and
    /// reconcile leaves it alone.
    pub fn holds_computer(self) -> bool {
        match self {
            Self::Replacing | Self::Verifying | Self::RollingBack => true,
            Self::Waiting
            | Self::Upgraded
            | Self::Skipped
            | Self::RolledBack
            | Self::RollbackFailed => false,
        }
    }

    /// Whether the computer is finished with this upgrade.
    pub fn is_finished(self) -> bool {
        match self {
            Self::Upgraded | Self::Skipped | Self::RolledBack | Self::RollbackFailed => true,
            Self::Waiting | Self::Replacing | Self::Verifying | Self::RollingBack => false,
        }
    }

    /// Whether this outcome pauses the upgrade.
    pub fn pauses_upgrade(self) -> bool {
        matches!(
            self,
            Self::RollingBack | Self::RolledBack | Self::RollbackFailed
        )
    }
}

/// One upgrade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageUpgrade {
    /// The upgrade.
    pub id: UpgradeId,
    /// The image it rolls out.
    pub image: ImageVersion,
    /// The image's files.
    pub files: ImageFiles,
    /// Where hosts fetch them; dropped once staged.
    pub sources: Option<Vec<ImageSource>>,
    /// Computers under way at once.
    pub batch_size: u8,
    /// After this, a computer never idle is skipped.
    pub idle_deadline_at: DateTime<Utc>,
    /// How long macrod has to connect after a boot.
    pub reconnect_timeout: Duration,
    /// Where it stands.
    pub state: UpgradeState,
    /// Why it failed or paused.
    pub error: Option<String>,
    /// Who asked for it (a workflow run).
    pub created_by: String,
    /// When.
    pub created_at: DateTime<Utc>,
}

/// One computer of an upgrade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerUpgrade {
    /// The upgrade.
    pub upgrade_id: UpgradeId,
    /// The computer.
    pub computer_id: ComputerId,
    /// Its place in the order computers start in.
    pub position: u16,
    /// Where it stands.
    pub state: ComputerUpgradeState,
    /// The image it ran before; set when its replacement starts.
    pub old_image: Option<GuestImage>,
    /// The image it moves to.
    pub new_image: GuestImage,
    /// When its current state began (replacement, verification, rollback).
    pub phase_started_at: Option<DateTime<Utc>>,
    /// When macrod last connected while it was under way.
    pub reconnected_at: Option<DateTime<Utc>>,
    /// What went wrong, or why it was skipped.
    pub error: Option<String>,
}

impl ComputerUpgrade {
    /// Whether macrod connected since the current state began.
    pub fn reconnected(&self) -> bool {
        match (self.reconnected_at, self.phase_started_at) {
            (Some(connected), Some(started)) => connected >= started,
            _ => false,
        }
    }

    /// Whether macrod has had `timeout` since the current state began.
    pub fn timed_out(&self, timeout: Duration, now: DateTime<Utc>) -> bool {
        self.phase_started_at
            .is_some_and(|started| now >= started + timeout)
    }
}

/// An upgrade as asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewImageUpgrade {
    /// The image.
    pub image: ImageVersion,
    /// Its files and where to fetch them.
    pub sources: Vec<ImageSource>,
    /// The computers, in the order they move.
    pub computers: Vec<ComputerId>,
    /// Computers under way at once, 1..=[`MAX_BATCH_SIZE`].
    pub batch_size: u8,
    /// How long computers may stay busy before they are skipped.
    pub idle_wait: Duration,
    /// How long macrod has to connect after a boot.
    pub reconnect_timeout: Duration,
    /// Who asks (a workflow run).
    pub created_by: String,
}

/// Why an upgrade cannot start.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StartUpgradeError {
    /// The files are not the three, once each.
    #[error(transparent)]
    Files(#[from] InvalidImageFiles),
    /// No computers, too many, or one named twice.
    #[error("an upgrade names 1 to {MAX_COMPUTERS} distinct computers")]
    Computers,
    /// Batch size outside 1..=[`MAX_BATCH_SIZE`].
    #[error("the batch size is 1 to {MAX_BATCH_SIZE}")]
    BatchSize,
    /// An idle wait or reconnect timeout out of range.
    #[error("the idle wait is at most 24 hours and the reconnect timeout 1 to 30 minutes")]
    Durations,
    /// Another upgrade is not finished.
    #[error("another image upgrade is under way")]
    AnotherUnderWay,
    /// The version was rolled out before with other files.
    #[error("{0} was rolled out before with other files; image versions are immutable")]
    VersionReused(ImageVersion),
    /// A computer does not exist.
    #[error("computer {0} does not exist")]
    UnknownComputer(ComputerId),
}

impl NewImageUpgrade {
    /// The files, once the request is checked.
    pub fn validate(&self) -> Result<ImageFiles, StartUpgradeError> {
        let files = ImageFiles::try_new(
            self.sources
                .iter()
                .map(|source| source.file.clone())
                .collect(),
        )?;
        let mut computers = self.computers.clone();
        computers.sort_unstable_by_key(|id| id.as_uuid());
        computers.dedup();
        if computers.is_empty()
            || computers.len() > MAX_COMPUTERS
            || computers.len() != self.computers.len()
        {
            return Err(StartUpgradeError::Computers);
        }
        if !(1..=MAX_BATCH_SIZE).contains(&self.batch_size) {
            return Err(StartUpgradeError::BatchSize);
        }
        if self.idle_wait < Duration::zero()
            || self.idle_wait > MAX_IDLE_WAIT
            || self.reconnect_timeout < Duration::minutes(1)
            || self.reconnect_timeout > MAX_RECONNECT_TIMEOUT
        {
            return Err(StartUpgradeError::Durations);
        }
        Ok(files)
    }
}

/// What the pass does next with an upgrade's computers, from their states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    /// Computers to try now, in order: at most the batch's free places.
    pub to_start: Vec<ComputerId>,
}

/// Which waiting computers may start: none once the upgrade is paused,
/// otherwise the first waiting ones up to the batch size minus those under
/// way.
pub fn next_batch(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) -> Batch {
    if upgrade.state != UpgradeState::Rolling {
        return Batch {
            to_start: Vec::new(),
        };
    }
    let under_way = computers
        .iter()
        .filter(|computer| computer.state.holds_computer())
        .count();
    let free = usize::from(upgrade.batch_size).saturating_sub(under_way);
    let mut waiting: Vec<&ComputerUpgrade> = computers
        .iter()
        .filter(|computer| computer.state == ComputerUpgradeState::Waiting)
        .collect();
    waiting.sort_by_key(|computer| computer.position);
    Batch {
        to_start: waiting
            .into_iter()
            .take(free)
            .map(|computer| computer.computer_id)
            .collect(),
    }
}

/// The upgrade's state once its computers stand as they do: paused once
/// one rolled back, done once all finished.
pub fn settled_state(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) -> UpgradeState {
    match upgrade.state {
        UpgradeState::Rolling if computers.iter().any(|c| c.state.pauses_upgrade()) => {
            UpgradeState::Paused
        }
        UpgradeState::Rolling if computers.iter().all(|c| c.state.is_finished()) => {
            UpgradeState::Done
        }
        state => state,
    }
}

/// Whether nothing is left for the pass: a staged upgrade whose computers
/// all finished, or one that failed staging.
pub fn is_finished(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) -> bool {
    match upgrade.state {
        UpgradeState::Done | UpgradeState::Failed => true,
        UpgradeState::Paused => computers
            .iter()
            .all(|computer| !computer.state.holds_computer()),
        UpgradeState::Staging | UpgradeState::Rolling => false,
    }
}

/// Image upgrades, stored with the computers.
pub trait ImageUpgrades: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Record a new upgrade and its computers, unless another is not
    /// finished, a computer does not exist, or the version was rolled out
    /// with other files.
    fn create_upgrade(
        &self,
        upgrade: &NewImageUpgrade,
        files: &ImageFiles,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Result<ImageUpgrade, StartUpgradeError>, Self::Err>> + Send;

    /// Lease the unfinished upgrade for `holder` until `until`, unless
    /// another replica holds it; with its computers.
    fn lease_upgrade(
        &self,
        holder: Uuid,
        now: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, Self::Err>> + Send;

    /// An upgrade and its computers.
    fn upgrade(
        &self,
        id: UpgradeId,
    ) -> impl Future<Output = Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, Self::Err>> + Send;

    /// Save the upgrade's state, error and sources; a finished one is
    /// released and records when it finished.
    fn update_upgrade(
        &self,
        upgrade: &ImageUpgrade,
        finished: bool,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Save one computer's state, images, phase start and error. Its
    /// `reconnected_at` is the store's: applying a macrod connection to a
    /// computer under way sets it, and only a connection after the phase
    /// began counts ([`ComputerUpgrade::reconnected`]).
    fn update_computer_upgrade(
        &self,
        computer: &ComputerUpgrade,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// What a host does for image upgrades, beside running computers.
pub trait HostImages: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: HostImageError;

    /// Stage the image unless the host holds it already; where it stands.
    fn stage_image(
        &self,
        image: &ImageVersion,
        sources: &[ImageSource],
    ) -> impl Future<Output = Result<StagedImage, Self::Err>> + Send;

    /// Where the image stands on the host, staged or not.
    fn staged_image(
        &self,
        image: &ImageVersion,
    ) -> impl Future<Output = Result<StagedImage, Self::Err>> + Send;

    /// Boot the computer from a system disk of `image` (or back to its
    /// previous one), keeping its `/home` and identity. A running computer
    /// is stopped and cold booted; a stopped one stays stopped. Answers the
    /// image the computer now boots.
    fn replace_system_disk(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> impl Future<Output = Result<GuestImage, Self::Err>> + Send;
}

/// Classifies a [`HostImages`] failure.
pub trait HostImageError: std::error::Error + Send + Sync + 'static {
    /// The image's golden for the computer's shape is still being built:
    /// asking again later succeeds.
    fn is_golden_not_ready(&self) -> bool;
}

/// Where an image stands on a host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StagedImage {
    /// Not on the host and not staging.
    Absent,
    /// Downloading or being checked.
    Staging,
    /// In place with these files; `None` when the host never checked them
    /// (staged by hand).
    Ready(Option<Vec<ImageFile>>),
    /// Staging failed; staging again retries.
    Failed(String),
    /// In place with other files: never replaced.
    Conflict(Vec<ImageFile>),
}
