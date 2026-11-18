//! `bundle-stamp`: the only producer of `bundle-manifest.json`.
//!
//! Every pipeline that builds the web bundle (web deploys, desktop Nix, iOS,
//! Android, local `just build-*`) stamps it here, so its identity comes from
//! the source commit and never from the build time. See `AGENTS.md`.

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use bundle_identity::{
    BuiltAt, BundleBuild, BundleManifest, CommitSha, CommitTime, NativeFloor, SourceCommit,
};
use clap::{Args, Parser, Subcommand};
use rootcause::prelude::*;
use serde::Deserialize;

#[cfg(test)]
mod test;

/// The `index.html` placeholder the stamper replaces with the bundle build.
const BUNDLE_BUILD_PLACEHOLDER: &str = "__MACRO_BUNDLE_BUILD__";

/// The manifest file name inside `dist`.
const MANIFEST_FILE: &str = "bundle-manifest.json";

/// Largest integer JavaScript reads exactly (`Number.MAX_SAFE_INTEGER`); the
/// web app reads the manifest too.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Parser)]
#[command(
    name = "bundle-stamp",
    about = "Stamp and verify JavaScript bundle identity"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Write dist/bundle-manifest.json and stamp dist/index.html.
    Stamp(StampArgs),
    /// Check that a built bundle was stamped from the given commit.
    Verify(VerifyArgs),
    /// Print the bundle build of a commit, for update policy ranges.
    Number {
        /// The commit, as anything `git show` accepts.
        commit: String,
    },
}

#[derive(Args)]
struct StampArgs {
    /// The built bundle directory.
    #[arg(long)]
    dist: PathBuf,
    /// package.json whose `version` becomes `appVersion`.
    #[arg(long)]
    package_json: PathBuf,
    /// Full commit sha, for builds without a git checkout (Nix). Defaults to HEAD.
    #[arg(long, requires = "commit_time")]
    commit: Option<String>,
    /// Committer time of `--commit`, Unix seconds.
    #[arg(long, requires = "commit")]
    commit_time: Option<u64>,
    /// Omit `builtAt`, for reproducible builds.
    #[arg(long)]
    no_built_at: bool,
    /// Minimum native build (desktop, and iOS in schema 2).
    #[arg(long, env = "MIN_NATIVE_BUILD", default_value_t = 0)]
    min_native_build: u64,
    /// Minimum Android versionCode; requires the iOS minimum (schema 3).
    #[arg(
        long,
        env = "MIN_NATIVE_BUILD_ANDROID",
        requires = "min_native_build_ios"
    )]
    min_native_build_android: Option<u64>,
    /// Minimum iOS CFBundleVersion; requires the Android minimum (schema 3).
    #[arg(
        long,
        env = "MIN_NATIVE_BUILD_IOS",
        requires = "min_native_build_android"
    )]
    min_native_build_ios: Option<u64>,
}

#[derive(Args)]
struct VerifyArgs {
    /// The built bundle directory.
    #[arg(long)]
    dist: PathBuf,
    /// The full sha the bundle must be stamped from.
    #[arg(long)]
    commit: String,
    /// A live manifest the bundle must not be older than (rollback guard).
    #[arg(long)]
    not_older_than: Option<PathBuf>,
}

fn main() -> Result<(), Report> {
    match Cli::parse().command {
        Commands::Stamp(args) => {
            let source = match (args.commit.as_deref(), args.commit_time) {
                (Some(sha), Some(secs)) => {
                    SourceCommit::new(sha.parse()?, CommitTime::try_new(secs)?)
                }
                _ => git_commit(Path::new("."), "HEAD")?,
            };
            let source = source.checked_against(unix_now().as_secs())?;
            let built_at = (!args.no_built_at).then(|| {
                let millis = u64::try_from(unix_now().as_millis()).unwrap_or(u64::MAX);
                BuiltAt::from_unix_millis(millis)
            });
            let floor = native_floor(
                args.min_native_build,
                args.min_native_build_android,
                args.min_native_build_ios,
            )?;
            let manifest = stamp(&args.dist, &args.package_json, source, built_at, floor)?;
            println!(
                "stamped {} from {} ({})",
                manifest.bundle_build(),
                manifest.source().sha(),
                args.dist.display()
            );
        }
        Commands::Verify(args) => {
            let commit: CommitSha = args.commit.parse()?;
            verify(&args.dist, &commit, args.not_older_than.as_deref())?;
            println!("{} is stamped from {commit}", args.dist.display());
        }
        Commands::Number { commit } => {
            println!("{}", git_commit(Path::new("."), &commit)?.bundle_build());
        }
    }

    Ok(())
}

fn unix_now() -> std::time::Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

/// Read a commit's full sha and committer time. Works in shallow clones.
fn git_commit(repo: &Path, rev: &str) -> Result<SourceCommit, Report> {
    let output = Command::new("git")
        .args(["show", "-s", "--format=%H %ct", rev])
        .current_dir(repo)
        .output()
        .context("failed to run git")?;
    if !output.status.success() {
        bail!(
            "git show {rev} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    let stdout = String::from_utf8(output.stdout).context("git printed non-UTF-8 output")?;
    let Some((sha, secs)) = stdout.trim().split_once(' ') else {
        bail!("unexpected git show output: {stdout:?}");
    };
    let secs: u64 = secs
        .parse()
        .context("git printed a non-numeric commit time")?;

    Ok(SourceCommit::new(sha.parse()?, CommitTime::try_new(secs)?))
}

/// Schema 3 when both mobile minima are set, schema 2 otherwise.
fn native_floor(
    min_native_build: u64,
    android: Option<u64>,
    ios: Option<u64>,
) -> Result<NativeFloor, Report> {
    for value in [Some(min_native_build), android, ios].into_iter().flatten() {
        if value > MAX_SAFE_INTEGER {
            bail!("native minimum {value} exceeds the JavaScript safe integer range");
        }
    }

    match (android, ios) {
        (None, None) => Ok(NativeFloor::Shared { min_native_build }),
        (Some(android), Some(ios)) => Ok(NativeFloor::PerPlatform {
            min_native_build,
            android,
            ios,
        }),
        _ => bail!("set both MIN_NATIVE_BUILD_ANDROID and MIN_NATIVE_BUILD_IOS"),
    }
}

#[derive(Deserialize)]
struct PackageJson {
    version: String,
}

/// Write the manifest and replace the `index.html` placeholder.
fn stamp(
    dist: &Path,
    package_json: &Path,
    source: SourceCommit,
    built_at: Option<BuiltAt>,
    native_floor: NativeFloor,
) -> Result<BundleManifest, Report> {
    let package: PackageJson = serde_json::from_str(
        &std::fs::read_to_string(package_json)
            .context(format!("failed to read {}", package_json.display()))?,
    )
    .context(format!("invalid {}", package_json.display()))?;
    let manifest = BundleManifest::new(source, built_at, native_floor, package.version);

    // Check the placeholder before writing anything, so a failed stamp leaves
    // no manifest behind.
    let index_path = dist.join("index.html");
    let index_html = std::fs::read_to_string(&index_path)
        .context(format!("failed to read {}", index_path.display()))?;
    if !index_html.contains(BUNDLE_BUILD_PLACEHOLDER) {
        bail!(
            "{} is missing {BUNDLE_BUILD_PLACEHOLDER}",
            index_path.display()
        );
    }

    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(dist.join(MANIFEST_FILE), format!("{manifest_json}\n"))?;
    std::fs::write(
        &index_path,
        index_html.replace(
            BUNDLE_BUILD_PLACEHOLDER,
            &manifest.bundle_build().to_string(),
        ),
    )?;

    Ok(manifest)
}

/// A live manifest may predate commit stamping; only its number is compared.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveManifest {
    bundle_build: u64,
    commit_time: Option<u64>,
}

/// Fail unless `dist` is stamped from `commit` and, with `not_older_than`, is
/// not older than the live manifest. Equal passes: rebuilding one commit is fine.
fn verify(dist: &Path, commit: &CommitSha, not_older_than: Option<&Path>) -> Result<(), Report> {
    let manifest = BundleManifest::read_file(&dist.join(MANIFEST_FILE))?;
    if manifest.source().sha() != commit {
        bail!(
            "bundle is stamped from {}, expected {commit}",
            manifest.source().sha()
        );
    }

    let Some(live_path) = not_older_than else {
        return Ok(());
    };
    let live_json = std::fs::read_to_string(live_path)
        .context(format!("failed to read {}", live_path.display()))?;
    let live: LiveManifest = serde_json::from_str(&live_json)
        .context(format!("invalid live manifest {}", live_path.display()))?;
    let live_build = match live.commit_time {
        // A stamped live manifest must be self-consistent.
        Some(_) => serde_json::from_str::<BundleManifest>(&live_json)?.bundle_build(),
        None => BundleBuild::reported(live.bundle_build),
    };

    if manifest.bundle_build() < live_build {
        bail!(
            "bundle {} is older than the live bundle {live_build}; revert forward instead, or \
             dispatch Deploy Web App with rollback: true (infra/stacks/web-app/README.md)",
            manifest.bundle_build()
        );
    }

    Ok(())
}
