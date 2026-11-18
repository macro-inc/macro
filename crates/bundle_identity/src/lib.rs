//! Identity of a JavaScript bundle, derived from the commit it was built from.
//!
//! Native apps embed a bundle and later download newer ones over the air. Both
//! sides must number bundles the same way, or an app can be offered a bundle
//! from an older commit, or the same commit, as an "update". This crate makes
//! the number a function of the source commit only: [`SourceCommit::bundle_build`]
//! is the one way to produce a [`BundleBuild`] for something we build, and a
//! [`BundleManifest`] cannot hold a number that disagrees with its commit.
//!
//! Changing the encoding or the manifest wire format desyncs the server from
//! apps in the field, so it needs a native release (see `AGENTS.md`).
#![deny(missing_docs)]

use std::{fmt, path::Path, str::FromStr};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(test)]
mod test;

/// How far a commit's committer time may be ahead of the stamping machine's
/// clock. Store builds are cut from PR heads made on developer machines.
pub const MAX_CLOCK_SKEW_SECS: u64 = 60 * 60;

/// Length of a full hexadecimal SHA-1 commit id.
const COMMIT_SHA_LEN: usize = 40;

/// Milliseconds per second: [`BundleBuild`] keeps the millisecond scale that
/// apps in the field already report.
const MILLIS_PER_SEC: u64 = 1000;

/// Manifest schema with one native minimum for every platform.
const SHARED_FLOOR_SCHEMA: u64 = 2;

/// Manifest schema with independent Android and iOS minima.
const PER_PLATFORM_FLOOR_SCHEMA: u64 = 3;

/// Why a bundle identity or manifest was rejected.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IdentityError {
    /// The commit id is not 40 lowercase hexadecimal digits.
    #[error("commit sha must be 40 lowercase hex digits, got {0:?}")]
    InvalidCommitSha(String),
    /// The commit time is zero or too large to express in milliseconds.
    #[error("commit time {0} is not a valid Unix timestamp in seconds")]
    InvalidCommitTime(u64),
    /// The committer clock was ahead of the stamping clock by more than
    /// [`MAX_CLOCK_SKEW_SECS`].
    #[error("commit time {commit_secs} is more than {MAX_CLOCK_SKEW_SECS}s after now ({now_secs})")]
    CommitInFuture {
        /// Committer time of the commit, Unix seconds.
        commit_secs: u64,
        /// The stamping machine's clock, Unix seconds.
        now_secs: u64,
    },
    /// The manifest names no commit time, so it was not stamped from a commit.
    #[error("bundle manifest has no commitTime; it was not stamped by bundle-stamp")]
    MissingCommitTime,
    /// The manifest names no commit.
    #[error("bundle manifest has no gitSha; it was not stamped by bundle-stamp")]
    MissingGitSha,
    /// The manifest's number is not the one its commit derives.
    #[error("bundleBuild {bundle_build} does not match commitTime (expected {expected})")]
    BundleBuildMismatch {
        /// The number the manifest states.
        bundle_build: u64,
        /// The number its commit derives.
        expected: u64,
    },
    /// The schema version does not match the native minima the manifest holds.
    #[error(
        "unsupported manifest schema {schema_version} (platform minima present: {has_platform_minima})"
    )]
    UnsupportedSchema {
        /// The stated schema version.
        schema_version: u64,
        /// Whether `minNativeBuilds` was present.
        has_platform_minima: bool,
    },
}

/// Full 40-hex lowercase commit id. Its shape is checked when it is built.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CommitSha(String);

impl CommitSha {
    /// The commit id as text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for CommitSha {
    type Err = IdentityError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_from(value.to_owned())
    }
}

impl TryFrom<String> for CommitSha {
    type Error = IdentityError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let well_formed = value.len() == COMMIT_SHA_LEN
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if !well_formed {
            return Err(IdentityError::InvalidCommitSha(value));
        }

        Ok(Self(value))
    }
}

impl fmt::Display for CommitSha {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Committer timestamp of the source commit, in Unix seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CommitTime(u64);

impl CommitTime {
    /// Accept a positive timestamp whose millisecond form fits in a `u64`.
    pub fn try_new(secs: u64) -> Result<Self, IdentityError> {
        if secs == 0 || secs.checked_mul(MILLIS_PER_SEC).is_none() {
            return Err(IdentityError::InvalidCommitTime(secs));
        }

        Ok(Self(secs))
    }

    /// The timestamp in Unix seconds.
    pub fn secs(self) -> u64 {
        self.0
    }
}

/// The commit a bundle was built from.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SourceCommit {
    sha: CommitSha,
    time: CommitTime,
}

impl SourceCommit {
    /// Name the commit a bundle is built from.
    pub fn new(sha: CommitSha, time: CommitTime) -> Self {
        Self { sha, time }
    }

    /// Reject a committer clock more than [`MAX_CLOCK_SKEW_SECS`] ahead of
    /// `now_secs`: a future-dated commit would outrank every later commit.
    pub fn checked_against(self, now_secs: u64) -> Result<Self, IdentityError> {
        let commit_secs = self.time.secs();
        if commit_secs > now_secs.saturating_add(MAX_CLOCK_SKEW_SECS) {
            return Err(IdentityError::CommitInFuture {
                commit_secs,
                now_secs,
            });
        }

        Ok(self)
    }

    /// The commit id.
    pub fn sha(&self) -> &CommitSha {
        &self.sha
    }

    /// The committer time.
    pub fn time(&self) -> CommitTime {
        self.time
    }

    /// The update ordering key for every bundle built from this commit. It
    /// depends on the commit alone, so an app's embedded bundle and the OTA
    /// bundle of the same commit always compare equal.
    pub fn bundle_build(&self) -> BundleBuild {
        // `CommitTime::try_new` guarantees the product fits.
        BundleBuild(self.time.secs() * MILLIS_PER_SEC)
    }
}

/// Update ordering key: a newer bundle has a greater value.
///
/// It is in milliseconds so it compares with numbers apps in the field already
/// report (legacy build timestamps, and desktop `commit_secs * 1000`). A value
/// for something we build comes only from [`SourceCommit::bundle_build`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct BundleBuild(u64);

impl BundleBuild {
    /// A number received across a boundary (a client query, policy config, an
    /// update response, a build-script env var). Never used to stamp a bundle.
    pub const fn reported(value: u64) -> Self {
        Self(value)
    }

    /// The number as sent on the wire.
    pub fn get(self) -> u64 {
        self.0
    }
}

impl fmt::Display for BundleBuild {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// When one build of a bundle ran, in Unix milliseconds. It tells rebuilds of
/// one commit apart (asset retention, the server's checksum cache). It has no
/// ordering relationship with [`BundleBuild`], so it can never decide an update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BuiltAt(u64);

impl BuiltAt {
    /// A build time in Unix milliseconds.
    pub fn from_unix_millis(millis: u64) -> Self {
        Self(millis)
    }

    /// The build time in Unix milliseconds.
    pub fn unix_millis(self) -> u64 {
        self.0
    }
}

/// The platforms a bundle states native minima for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativePlatform {
    /// Android, gated by versionCode.
    Android,
    /// iOS, gated by CFBundleVersion.
    Ios,
    /// Desktop (macOS, Linux, Windows).
    Desktop,
}

/// The oldest native build that can run a bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeFloor {
    /// Schema 2: one minimum. Android reads no minimum from it, because its
    /// versionCode is not comparable with the other platforms' numbers.
    Shared {
        /// Minimum native build.
        min_native_build: u64,
    },
    /// Schema 3: independent Android and iOS minima; desktop keeps the shared one.
    PerPlatform {
        /// Minimum desktop native build.
        min_native_build: u64,
        /// Minimum Android versionCode.
        android: u64,
        /// Minimum iOS CFBundleVersion.
        ios: u64,
    },
}

impl NativeFloor {
    fn schema_version(&self) -> u64 {
        match self {
            Self::Shared { .. } => SHARED_FLOOR_SCHEMA,
            Self::PerPlatform { .. } => PER_PLATFORM_FLOOR_SCHEMA,
        }
    }
}

/// `bundle-manifest.json`, the metadata stamped into every bundle build.
///
/// Deserializing rejects a manifest that is not stamped from a commit or whose
/// `bundleBuild` disagrees with its `commitTime`; serializing writes the derived
/// number. So a value of this type is always self-consistent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "WireManifest", try_from = "WireManifest")]
pub struct BundleManifest {
    source: SourceCommit,
    built_at: Option<BuiltAt>,
    native_floor: NativeFloor,
    app_version: String,
}

/// Why reading a manifest file failed.
#[derive(Debug, Error)]
pub enum ReadManifestError {
    /// The file could not be read.
    #[error("failed to read {path}: {source}")]
    Io {
        /// The manifest path.
        path: String,
        /// The underlying error.
        source: std::io::Error,
    },
    /// The file is not a valid stamped manifest.
    #[error("invalid bundle manifest {path}: {source}")]
    Invalid {
        /// The manifest path.
        path: String,
        /// The parse or validation error.
        source: serde_json::Error,
    },
}

impl BundleManifest {
    /// A manifest for a bundle built from `source`. `built_at` is `None` for
    /// reproducible builds.
    pub fn new(
        source: SourceCommit,
        built_at: Option<BuiltAt>,
        native_floor: NativeFloor,
        app_version: String,
    ) -> Self {
        Self {
            source,
            built_at,
            native_floor,
            app_version,
        }
    }

    /// Read and validate a manifest file, such as the one embedded in a native build.
    pub fn read_file(path: &Path) -> Result<Self, ReadManifestError> {
        let display = path.display().to_string();
        let contents = std::fs::read_to_string(path).map_err(|source| ReadManifestError::Io {
            path: display.clone(),
            source,
        })?;
        serde_json::from_str(&contents).map_err(|source| ReadManifestError::Invalid {
            path: display,
            source,
        })
    }

    /// The update ordering key, derived from the source commit.
    pub fn bundle_build(&self) -> BundleBuild {
        self.source.bundle_build()
    }

    /// The commit the bundle was built from.
    pub fn source(&self) -> &SourceCommit {
        &self.source
    }

    /// When this build ran, if it records one.
    pub fn built_at(&self) -> Option<BuiltAt> {
        self.built_at
    }

    /// The manifest schema version on the wire.
    pub fn schema_version(&self) -> u64 {
        self.native_floor.schema_version()
    }

    /// The native minima the bundle states.
    pub fn native_floor(&self) -> &NativeFloor {
        &self.native_floor
    }

    /// The application package version the bundle was built with.
    pub fn app_version(&self) -> &str {
        &self.app_version
    }

    /// The oldest native build on `platform` that can run this bundle, or
    /// `None` when the bundle states no minimum the platform can use.
    pub fn minimum_for(&self, platform: NativePlatform) -> Option<u64> {
        match (&self.native_floor, platform) {
            (NativeFloor::Shared { .. }, NativePlatform::Android) => None,
            (NativeFloor::Shared { min_native_build }, _) => Some(*min_native_build),
            (NativeFloor::PerPlatform { android, .. }, NativePlatform::Android) => Some(*android),
            (NativeFloor::PerPlatform { ios, .. }, NativePlatform::Ios) => Some(*ios),
            // Desktop release numbers come from hand-typed tags, so it keeps
            // the shared minimum.
            (
                NativeFloor::PerPlatform {
                    min_native_build, ..
                },
                NativePlatform::Desktop,
            ) => Some(*min_native_build),
        }
    }
}

/// The JSON shape of `bundle-manifest.json`. Readers deployed before commit
/// stamping ignore `commitTime` and `builtAt` and read `bundleBuild` as is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireManifest {
    schema_version: u64,
    bundle_build: u64,
    #[serde(default)]
    commit_time: Option<u64>,
    #[serde(default)]
    git_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    built_at: Option<u64>,
    min_native_build: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    min_native_builds: Option<WireMobileMinima>,
    app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WireMobileMinima {
    android: u64,
    ios: u64,
}

impl From<BundleManifest> for WireManifest {
    fn from(manifest: BundleManifest) -> Self {
        let schema_version = manifest.schema_version();
        let bundle_build = manifest.bundle_build().get();
        let (min_native_build, min_native_builds) = match manifest.native_floor {
            NativeFloor::Shared { min_native_build } => (min_native_build, None),
            NativeFloor::PerPlatform {
                min_native_build,
                android,
                ios,
            } => (min_native_build, Some(WireMobileMinima { android, ios })),
        };

        Self {
            schema_version,
            bundle_build,
            commit_time: Some(manifest.source.time.secs()),
            git_sha: Some(manifest.source.sha.0),
            built_at: manifest.built_at.map(BuiltAt::unix_millis),
            min_native_build,
            min_native_builds,
            app_version: manifest.app_version,
        }
    }
}

impl TryFrom<WireManifest> for BundleManifest {
    type Error = IdentityError;

    fn try_from(wire: WireManifest) -> Result<Self, Self::Error> {
        let time = CommitTime::try_new(wire.commit_time.ok_or(IdentityError::MissingCommitTime)?)?;
        let sha = CommitSha::try_from(wire.git_sha.ok_or(IdentityError::MissingGitSha)?)?;
        let source = SourceCommit::new(sha, time);

        let expected = source.bundle_build().get();
        if wire.bundle_build != expected {
            return Err(IdentityError::BundleBuildMismatch {
                bundle_build: wire.bundle_build,
                expected,
            });
        }

        let native_floor = match (wire.schema_version, wire.min_native_builds) {
            (SHARED_FLOOR_SCHEMA, None) => NativeFloor::Shared {
                min_native_build: wire.min_native_build,
            },
            (PER_PLATFORM_FLOOR_SCHEMA, Some(minima)) => NativeFloor::PerPlatform {
                min_native_build: wire.min_native_build,
                android: minima.android,
                ios: minima.ios,
            },
            (schema_version, minima) => {
                return Err(IdentityError::UnsupportedSchema {
                    schema_version,
                    has_platform_minima: minima.is_some(),
                });
            }
        };

        Ok(Self {
            source,
            built_at: wire.built_at.map(BuiltAt::from_unix_millis),
            native_floor,
            app_version: wire.app_version,
        })
    }
}
