//! The installs this macrod keeps, so it resumes them after a restart:
//! `~/.macrod/teammates/<harness>/<install>/` holds `install.json` (the
//! install, its delivery, its image and its lifecycle: the restart policy's
//! state, the image that last settled and the update in progress; no
//! credentials) and `agent.env`, the file bound into the container.

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use agent_runtime_protocol::domain::schema::v0::{
    TeammateHostReport, TeammateImage, TeammateInstall, TeammateInstallId,
};

/// The last host report's file in a harness's store.
const HOST_REPORT: &str = "host.json";
use rootcause::prelude::ResultExt as _;
use serde::{Deserialize, Serialize};
use teammate_lifecycle::replacement::ImageUpdate;
use teammate_lifecycle::supervisor::PolicyState;

/// One kept install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredInstall {
    /// The install and the generation it runs.
    pub install: TeammateInstall,
    /// The image that generation runs.
    pub image: TeammateImage,
    /// Where its life is, kept so a restarted macrod goes on from there.
    #[serde(default)]
    pub lifecycle: Lifecycle,
}

/// What the supervisor keeps across macrod restarts.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lifecycle {
    /// The restart policy's state: backoff, start rate, last exit, and
    /// whether it gave up (until a new delivery).
    #[serde(default)]
    pub policy: PolicyState,
    /// The last image that stayed up its trial: the one to go back to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settled_image: Option<TeammateImage>,
    /// This delivery's image update, once its image was fetched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update: Option<ImageUpdate<TeammateImage>>,
    /// Why macrod stopped it by itself; none for a stop the service asked
    /// for, which nothing undoes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped_for: Option<StopCause>,
}

/// Why macrod stopped an install without being asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopCause {
    /// The service refused the machine's harness credentials: run again
    /// on the next accepted dial (an unpaired machine never gets one).
    CredentialsRefused,
}

/// The install store of one harness.
#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    /// The store under `root`, created on the first write.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// `~/.macrod/teammates/<harness>`.
    #[cfg(not(test))]
    pub fn for_harness(harness_id: impl std::fmt::Display) -> rootcause::Result<Self> {
        Ok(Self::new(
            teammates_directory()?.join(harness_id.to_string()),
        ))
    }

    /// The install's directory.
    pub fn directory(&self, install_id: &TeammateInstallId) -> PathBuf {
        self.root.join(install_id.as_str())
    }

    /// The credentials file bound into the install's container.
    pub fn credentials_file(&self, install_id: &TeammateInstallId) -> PathBuf {
        self.directory(install_id).join("agent.env")
    }

    /// Every kept install. One whose `install.json` can't be read is
    /// skipped and logged: one bad install never stops the others.
    pub fn installs(&self) -> Vec<StoredInstall> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(error) => {
                tracing::warn!(error = %error, "could not read the teammate install store");
                return Vec::new();
            }
        };
        let mut installs = BTreeMap::new();
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Ok(install_id) = TeammateInstallId::new(name) else {
                continue;
            };
            match self.read(&install_id) {
                Ok(Some(stored)) if stored.install.install_id == install_id => {
                    installs.insert(install_id, stored);
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(install_id = install_id.as_str(), error = ?error, "skipping an unreadable teammate install");
                }
            }
        }
        installs.into_values().collect()
    }

    /// The kept install, `None` when there is none.
    pub fn read(&self, install_id: &TeammateInstallId) -> rootcause::Result<Option<StoredInstall>> {
        let path = self.directory(install_id).join("install.json");
        let contents = match std::fs::read(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(rootcause::report!(
                    "could not read {}: {error}",
                    path.display()
                ));
            }
        };
        let stored = serde_json::from_slice(&contents)
            .context(format!("{} is not an install", path.display()))?;
        Ok(Some(stored))
    }

    /// Keep a new generation: the credentials file first, then
    /// `install.json`, each written whole by rename, so a crash between
    /// them leaves the older generation's record with the newer key, which
    /// the next delivery replaces. The directory is 0700 and owned by
    /// macrod's user; the credentials file is 0644 so uid 1000 in the
    /// container reads it under any uid mapping.
    pub fn save(
        &self,
        stored: &StoredInstall,
        environment: &BTreeMap<String, String>,
    ) -> rootcause::Result<()> {
        let contents = crate::agent_env::env_file(&crate::agent_env::validated(environment)?);
        let directory = self.directory(&stored.install.install_id);
        create_private_directory(&directory)?;
        write_whole(&directory.join("agent.env"), contents.as_bytes(), 0o644)?;
        let record = serde_json::to_vec_pretty(stored).context("could not encode the install")?;
        write_whole(&directory.join("install.json"), &record, 0o600)?;
        Ok(())
    }

    /// Keep the delivery's lifecycle, unless a newer delivery is kept by
    /// now.
    pub fn save_lifecycle(
        &self,
        install: &TeammateInstall,
        lifecycle: &Lifecycle,
    ) -> rootcause::Result<()> {
        let install_id = &install.install_id;
        let Some(mut stored) = self.read(install_id)? else {
            return Ok(());
        };
        if &stored.install != install {
            return Ok(());
        }
        stored.lifecycle = lifecycle.clone();
        let record = serde_json::to_vec_pretty(&stored).context("could not encode the install")?;
        write_whole(
            &self.directory(install_id).join("install.json"),
            &record,
            0o600,
        )
    }

    /// Keep the last host report (engines, choice, problem) for
    /// `macrod teammate list`.
    pub fn save_host_report(&self, report: &TeammateHostReport) -> rootcause::Result<()> {
        create_private_directory(&self.root)?;
        let record =
            serde_json::to_vec_pretty(report).context("could not encode the host report")?;
        write_whole(&self.root.join(HOST_REPORT), &record, 0o600)
    }

    /// The last host report kept, if any.
    pub fn host_report(&self) -> Option<TeammateHostReport> {
        let contents = std::fs::read(self.root.join(HOST_REPORT)).ok()?;
        serde_json::from_slice(&contents).ok()
    }

    /// Forget the install: its credentials file and record.
    pub fn delete(&self, install_id: &TeammateInstallId) -> rootcause::Result<()> {
        let directory = self.directory(install_id);
        match std::fs::remove_dir_all(&directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(rootcause::report!(
                "could not delete {}: {error}",
                directory.display()
            )),
        }
    }
}

/// `~/.macrod/teammates`: every harness's store.
pub fn teammates_directory() -> rootcause::Result<PathBuf> {
    let macrod = crate::config::macrod_directory()
        .ok_or_else(|| rootcause::report!("HOME is required for the teammate install store"))?;
    Ok(macrod.join("teammates"))
}

/// Write a file macrod owns into `directory` (created 0700), whole, mode
/// 0644, and return its path.
pub fn write_file(directory: &Path, name: &str, contents: &[u8]) -> rootcause::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt as _;

    create_private_directory(directory)?;
    let path = directory.join(name);
    // Every macrod sharing the directory writes the same file when it
    // starts: one already there and whole needs no write.
    let unchanged = std::fs::metadata(&path)
        .is_ok_and(|metadata| metadata.permissions().mode() & 0o777 == 0o644)
        && std::fs::read(&path).is_ok_and(|existing| existing == contents);
    if !unchanged {
        write_whole(&path, contents, 0o644)?;
    }
    Ok(path)
}

fn create_private_directory(directory: &Path) -> rootcause::Result<()> {
    use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(directory)
        .context(format!("could not create {}", directory.display()))?;
    std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
        .context(format!("could not set the mode of {}", directory.display()))?;
    Ok(())
}

/// Write `contents` to a sibling of its own and rename it over `path`, so
/// `path` only ever holds a whole file, even with other processes (macrods
/// sharing `~/.macrod`) writing it at the same time.
fn write_whole(path: &Path, contents: &[u8], mode: u32) -> rootcause::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};

    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    // This writer's own: no other process or thread opens or renames it.
    let partial = path.with_file_name(format!(
        ".{name}.{}.{:016x}.partial",
        std::process::id(),
        rand::random::<u64>()
    ));
    let written = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&partial)
            .context(format!("could not open {}", partial.display()))?;
        // The mode is set again: `open` applies the umask.
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(mode))
            .context(format!("could not set the mode of {}", partial.display()))?;
        file.write_all(contents)
            .and_then(|()| file.sync_all())
            .context(format!("could not write {}", partial.display()))?;
        std::fs::rename(&partial, path).context(format!("could not write {}", path.display()))?;
        Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    written
}
