//! Forwarding the local stack's own telemetry. With `services = true` in the
//! settings file, `just run_local` starts a forwarder container (Grafana Alloy,
//! `docker/grafana-forwarder/`) that the machine's lgtm collector copies every
//! trace, log and metric to, and that sends them on, sampled and tagged with this
//! machine's name, to the settings' endpoint with its token. `xtask_local` runs
//! the containers; this module decides whether forwarding is on, names the
//! machine, and writes the token where only the forwarder reads it.

use std::fs::{DirBuilder, File, Permissions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::config::{Config, ConfigError, Paths, Setting, Switch, Token};

#[cfg(test)]
mod test;

/// The longest name `host.name` gets: one DNS label.
const MAX_MACHINE_NAME: usize = 63;

/// A machine's name as sent in `host.name`: 1 to 63 ASCII letters, digits, `-`
/// or `_`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MachineName(String);

impl MachineName {
    /// `value`, when it is a plain name.
    pub fn parse(value: &str) -> Option<Self> {
        let plain = !value.is_empty()
            && value.len() <= MAX_MACHINE_NAME
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
        plain.then(|| Self(value.to_owned()))
    }

    /// This machine's hostname up to its first dot: `solaris` for
    /// `solaris.example.internal`.
    pub fn of_this_host() -> Option<Self> {
        Self::parse(host_name()?.split('.').next()?)
    }

    /// The name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// This machine's full hostname.
pub fn host_name() -> Option<String> {
    let mut buffer = [0u8; 256];
    // SAFETY: gethostname writes at most `len` bytes into the buffer we own.
    let status = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if status != 0 {
        return None;
    }
    let end = buffer.iter().position(|byte| *byte == 0)?;
    String::from_utf8(buffer[..end].to_vec()).ok()
}

/// Why forwarding stays off although the settings ask for it.
#[derive(Debug, thiserror::Error)]
pub enum ForwardingError {
    /// The settings file can't be used.
    #[error(transparent)]
    Config(#[from] ConfigError),
    /// `services = true` without a token to send with.
    #[error("{path}: `services = true` needs a `token`")]
    NoToken {
        /// The settings file.
        path: PathBuf,
    },
    /// The hostname isn't a plain name and no `machine` replaces it.
    #[error(
        "{path}: this machine's hostname can't be used as its name; set `machine = \"<name>\"`"
    )]
    NoMachineName {
        /// The settings file.
        path: PathBuf,
    },
}

/// Where the stack's telemetry goes, with what, under which machine name.
#[derive(Debug)]
pub struct Forwarding {
    endpoint: String,
    token: Token,
    machine: MachineName,
}

impl Forwarding {
    /// What the settings file asks for: `Ok(None)` unless it says
    /// `services = true` and `MACRO_LOCAL_TELEMETRY`/`CI` don't turn telemetry off.
    pub fn load(paths: &Paths) -> Result<Option<Self>, ForwardingError> {
        if paths.switch == Switch::Off {
            return Ok(None);
        }
        match Config::load(&paths.config)? {
            Setting::On(config) if config.services() => {
                Self::from_config(config, &paths.config).map(Some)
            }
            Setting::On(_) | Setting::Off | Setting::Missing => Ok(None),
        }
    }

    fn from_config(config: Config, path: &Path) -> Result<Self, ForwardingError> {
        let machine = match config.machine() {
            Some(machine) => machine.clone(),
            None => MachineName::of_this_host().ok_or_else(|| ForwardingError::NoMachineName {
                path: path.to_owned(),
            })?,
        };
        let endpoint = config.endpoint().to_owned();
        let token = config
            .into_token()
            .ok_or_else(|| ForwardingError::NoToken {
                path: path.to_owned(),
            })?;
        Ok(Self {
            endpoint,
            token,
            machine,
        })
    }

    /// The OTLP/HTTP endpoint the forwarder sends to, without a trailing slash.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// The name everything forwarded is tagged with.
    pub fn machine(&self) -> &MachineName {
        &self.machine
    }

    /// Write the token to `path` for the forwarder to read: see [`write_private`].
    pub fn write_token(&self, path: &Path) -> std::io::Result<()> {
        write_private(path, self.token.expose().as_bytes())
    }
}

/// Write `contents` to `path`, readable only by this user, in a directory only
/// this user can enter, atomically replacing any file already there.
pub fn write_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(std::io::ErrorKind::InvalidInput.into());
    };
    DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    // An existing directory keeps its mode otherwise.
    std::fs::set_permissions(dir, Permissions::from_mode(0o700))?;
    let staging = dir.join(format!(
        ".{}.{}",
        name.to_string_lossy(),
        uuid::Uuid::now_v7().simple()
    ));
    let mut file = File::options()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staging)?;
    let result = file
        .write_all(contents)
        .and_then(|()| file.sync_all())
        .and_then(|()| std::fs::rename(&staging, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    result
}
