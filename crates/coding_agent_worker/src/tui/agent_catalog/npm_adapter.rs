//! Agents reached through an ACP adapter distributed on npm.
//!
//! The adapter is installed once, into a directory named after its pinned
//! version under macrod's own adapter root, and launched from there directly.
//! `npx -y <package>@<version>` would install the same thing, but it does so
//! on every launch: an npm start-up plus a registry round trip before the
//! adapter even runs, on every bridge start and every model probe.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use super::{AgentPreset, Availability, CommandLookup, DetectedAgent, LaunchSpec, is_launch};
use crate::config::Harness;

/// An npm-distributed ACP adapter pinned to one version.
pub(super) struct NpmAdapter {
    /// The exact package to install, `@scope/name@version`.
    pub(super) package: &'static str,
    /// The executable the package installs under `node_modules/.bin`.
    pub(super) bin: &'static str,
    /// The CLI the adapter wraps.
    pub(super) cli: &'static str,
    /// The variable the adapter reads for the CLI to run. The adapter bundles
    /// its own copy of `cli` and runs that one by default; the copy can be
    /// older than the one installed here, advertising a different model
    /// catalogue. The value must be absolute: a bare name is looked up on the
    /// adapter's `PATH`, where its own `node_modules/.bin` comes first.
    pub(super) cli_path_env: &'static str,
}

impl NpmAdapter {
    pub(super) fn detect(
        &self,
        preset: &dyn AgentPreset,
        commands: &dyn CommandLookup,
    ) -> Availability {
        let missing = [self.cli, "npm"]
            .into_iter()
            .filter(|command| commands.resolve(command).is_none())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Availability::Unavailable { missing };
        }
        let (Some(cli_path), Some(root)) = (commands.resolve(self.cli), commands.adapter_root())
        else {
            return Availability::Unavailable {
                missing: vec!["HOME"],
            };
        };
        let install = AdapterInstall {
            package: self.package,
            prefix: root.join(self.package),
            bin: root.join(self.bin_path()),
        };
        Availability::Available(DetectedAgent {
            kind: preset.kind(),
            name: preset.name(),
            launch: LaunchSpec::new(&install.bin.to_string_lossy(), [])
                .with_env(self.cli_path_env, cli_path),
            note: Some("via npm ACP adapter"),
            install: Some(install),
        })
    }

    /// Whether `harness` launches this adapter at this version, installed by
    /// macrod or through `npx` as earlier releases wrote it.
    pub(super) fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", self.package])
            || (harness.args.is_empty() && Path::new(&harness.command).ends_with(self.bin_path()))
    }

    /// The executable relative to the adapter root. Carrying the package
    /// version in the path is what makes an existing installation trustworthy
    /// without inspecting it.
    fn bin_path(&self) -> PathBuf {
        Path::new(self.package)
            .join("node_modules")
            .join(".bin")
            .join(self.bin)
    }
}

/// A pinned npm package to install before its executable can be launched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterInstall {
    /// The exact package, `@scope/name@version`.
    pub package: &'static str,
    /// The `npm --prefix` directory holding this one version.
    pub prefix: PathBuf,
    /// The executable the installation produces.
    pub bin: PathBuf,
}

impl AdapterInstall {
    /// Whether the executable is already in place.
    pub fn is_installed(&self) -> bool {
        self.bin.exists()
    }

    /// Install the package unless its executable is already in place.
    pub async fn run(&self) -> Result<(), String> {
        if self.is_installed() {
            return Ok(());
        }
        let output = tokio::process::Command::new("npm")
            .args(["install", "--no-audit", "--no-fund", "--loglevel=error"])
            .arg("--prefix")
            .arg(&self.prefix)
            .arg(self.package)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|error| format!("could not run npm to install {}: {error}", self.package))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "npm install {} failed: {}",
                self.package,
                stderr.trim().lines().last().unwrap_or("no output")
            ));
        }
        if !self.bin.exists() {
            return Err(format!(
                "npm install {} produced no {}",
                self.package,
                self.bin.display()
            ));
        }
        Ok(())
    }
}
