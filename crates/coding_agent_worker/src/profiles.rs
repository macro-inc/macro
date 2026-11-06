//! Which config a macrod serves. One machine runs one runtime per config: the
//! default `~/.macrod/macrod.toml`, and named profiles at
//! `~/.macrod/profiles/<name>.toml` (`--profile <name>`). `--config <path>`
//! names any other file.
//!
//! Releases before the shared config read `./macrod.toml` from the folder the
//! control panel started in. [`adopt_folder_config`] moves such a file into
//! `~/.macrod` the first time `macrod` starts there, so the runtime it paired
//! keeps serving instead of being swapped for another.

use std::fmt;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use harness_id::HarnessId;

use crate::config::{self, Config, HarnessCredentials, LockError};

#[cfg(test)]
mod test;

/// The config file name, in `~/.macrod` and in the folders older releases
/// read it from.
const CONFIG_FILE: &str = "macrod.toml";
/// Where named profiles live inside `~/.macrod`.
const PROFILES_DIRECTORY: &str = "profiles";
const PROFILE_EXTENSION: &str = "toml";
/// The profile name used when a folder or host name has no usable characters.
const UNNAMED_PROFILE: &str = "macrod";

/// A profile's name: lowercase letters, digits, `-`, and `_`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProfileName(String);

/// A string that is not a valid [`ProfileName`].
#[derive(Debug, thiserror::Error)]
#[error("`{0}` is not a profile name: use lowercase letters, digits, `-`, and `_`")]
pub struct InvalidProfileName(String);

impl FromStr for ProfileName {
    type Err = InvalidProfileName;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if lazy_regex::regex_is_match!(r"^[a-z0-9_-]+$", value) {
            Ok(Self(value.to_owned()))
        } else {
            Err(InvalidProfileName(value.to_owned()))
        }
    }
}

impl fmt::Display for ProfileName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl ProfileName {
    /// The profile name closest to free text such as a folder or host name:
    /// lowercased, with each run of other characters turned into one `-`.
    fn from_label(label: &str) -> Self {
        let mut name = String::new();
        for character in label.chars().flat_map(char::to_lowercase) {
            let allowed = character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '_'
                || character == '-';
            if allowed {
                name.push(character);
            } else if !name.ends_with('-') {
                name.push('-');
            }
        }
        name.trim_matches('-')
            .parse()
            .unwrap_or_else(|_| Self(UNNAMED_PROFILE.to_owned()))
    }

    /// `name` for 1, `name-<number>` after that.
    fn numbered(&self, number: u32) -> Self {
        if number <= 1 {
            self.clone()
        } else {
            Self(format!("{}-{number}", self.0))
        }
    }
}

/// `~/.macrod`: the default config and the profiles beside it.
#[derive(Debug, Clone)]
pub struct MacrodHome {
    directory: PathBuf,
}

impl MacrodHome {
    /// This user's `~/.macrod`.
    pub fn locate() -> rootcause::Result<Self> {
        config::macrod_directory()
            .map(|directory| Self { directory })
            .ok_or_else(|| {
                rootcause::report!(
                    "no home directory: pass --config or set HOME (USERPROFILE on Windows)"
                )
            })
    }

    /// A macrod directory at `directory`.
    #[cfg(test)]
    pub fn at(directory: &Path) -> Self {
        Self {
            directory: directory.to_owned(),
        }
    }

    /// `~/.macrod/macrod.toml`.
    pub fn default_config(&self) -> PathBuf {
        self.directory.join(CONFIG_FILE)
    }

    fn profiles_directory(&self) -> PathBuf {
        self.directory.join(PROFILES_DIRECTORY)
    }

    /// `~/.macrod/profiles/<name>.toml`.
    pub fn profile_config(&self, name: &ProfileName) -> PathBuf {
        self.profiles_directory()
            .join(format!("{name}.{PROFILE_EXTENSION}"))
    }

    /// `base` numbered from `first_number` up, the first with no config yet.
    fn first_unused_profile(&self, base: &ProfileName, first_number: u32) -> ProfileName {
        let mut number = first_number;
        loop {
            let name = base.numbered(number);
            if !self.profile_config(&name).exists() {
                return name;
            }
            number += 1;
        }
    }

    /// Every named profile, sorted. Files whose name is not a profile name
    /// cannot be selected with `--profile`, so they are left out.
    fn profiles(&self) -> std::io::Result<Vec<ProfileName>> {
        let entries = match std::fs::read_dir(self.profiles_directory()) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut names = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some(PROFILE_EXTENSION)
            {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .and_then(|stem| stem.parse().ok());
            if let Some(name) = name {
                names.push(name);
            }
        }
        names.sort();
        Ok(names)
    }

    /// The profile name offered for a second runtime on this machine:
    /// `<host>-2`, or the next number not taken yet.
    pub fn suggested_profile(&self, machine_name: &str) -> ProfileName {
        self.first_unused_profile(&ProfileName::from_label(machine_name), 2)
    }
}

/// The config one macrod serves, and the profile it is, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigSelection {
    /// The config file.
    pub path: PathBuf,
    /// The named profile `path` belongs to; `None` for the default config
    /// and `--config` paths.
    pub profile: Option<ProfileName>,
}

impl ConfigSelection {
    /// The config `--config` or `--profile` names, else the default one.
    pub fn resolve(
        config: Option<PathBuf>,
        profile: Option<ProfileName>,
    ) -> rootcause::Result<Self> {
        match (config, profile) {
            (Some(_), Some(_)) => rootcause::bail!("pass --config or --profile, not both"),
            (Some(path), None) => Ok(Self {
                path,
                profile: None,
            }),
            (None, Some(profile)) => Ok(Self::profile_in(&MacrodHome::locate()?, profile)),
            (None, None) => Ok(Self::default_in(&MacrodHome::locate()?)),
        }
    }

    /// `~/.macrod/macrod.toml`.
    pub fn default_in(home: &MacrodHome) -> Self {
        Self {
            path: home.default_config(),
            profile: None,
        }
    }

    /// `~/.macrod/profiles/<profile>.toml`.
    pub fn profile_in(home: &MacrodHome, profile: ProfileName) -> Self {
        Self {
            path: home.profile_config(&profile),
            profile: Some(profile),
        }
    }

    /// The name a pairing requests: the machine's name, and the profile's
    /// after it. The default config keeps just the machine's name.
    pub fn pairing_name(&self, machine_name: &str) -> String {
        match &self.profile {
            Some(profile) => format!("{machine_name} · {profile}"),
            None => machine_name.to_owned(),
        }
    }

    /// The command that starts the control panel on this config again.
    pub fn command(&self) -> String {
        match &self.profile {
            Some(profile) => format!("macrod --profile {profile}"),
            None => "macrod".to_owned(),
        }
    }
}

/// A folder's `macrod.toml`, moved into `~/.macrod` and served from there.
#[derive(Debug, PartialEq, Eq)]
pub struct AdoptedFolderConfig {
    /// Where the file was.
    pub from: PathBuf,
    /// Where it is now.
    pub selection: ConfigSelection,
}

impl AdoptedFolderConfig {
    /// The one line that tells the operator what moved and how to start it.
    pub fn announcement(&self) -> String {
        format!(
            "moved {} to {} and is serving it; from now on run `{}` from any folder",
            self.from.display(),
            self.selection.path.display(),
            self.selection.command(),
        )
    }
}

/// Why a folder's `macrod.toml` could not be moved into `~/.macrod`.
#[derive(Debug, thiserror::Error)]
pub enum AdoptError {
    /// A macrod started with `--config` is serving the folder's file.
    #[error(
        "another macrod is running with {path}; stop it first, or run `macrod --config {path}`"
    )]
    Served {
        /// The folder's config.
        path: PathBuf,
    },
    /// Checking or moving the file failed.
    #[error("could not move {} into {}", from.display(), to.display())]
    Move {
        /// The folder's config.
        from: PathBuf,
        /// Where it was going.
        to: PathBuf,
        /// What the filesystem returned.
        #[source]
        source: std::io::Error,
    },
}

/// Move `<folder>/macrod.toml`, the config older releases read from the
/// folder they started in, into `home` and select it.
///
/// It becomes the default config when there is none yet; otherwise a profile
/// named after the folder (numbered when that name is taken), so the runtime it
/// paired keeps its identity. Nothing happens when the folder has no
/// `macrod.toml` or it is the default config itself.
pub fn adopt_folder_config(
    folder: &Path,
    home: &MacrodHome,
) -> Result<Option<AdoptedFolderConfig>, AdoptError> {
    let from = folder.join(CONFIG_FILE);
    if !from.is_file() || is_same_file(&from, &home.default_config()) {
        return Ok(None);
    }
    // Held across the move: a macrod already serving this file with
    // `--config` keeps it.
    let folder_lock = match config::lock(&from) {
        Ok(lock) => lock,
        Err(LockError::Held { path }) => return Err(AdoptError::Served { path }),
        Err(LockError::Io { source, .. }) => {
            return Err(AdoptError::Move {
                to: home.default_config(),
                from,
                source,
            });
        }
    };
    let moved = choose_destination(folder, home, &from).and_then(|selection| {
        move_private(&from, &selection.path).map_err(|source| AdoptError::Move {
            from: from.clone(),
            to: selection.path.clone(),
            source,
        })?;
        Ok(selection)
    });
    drop(folder_lock);
    if let Err(error) = config::remove_lock_file(&from) {
        tracing::warn!(error = ?error, path = %from.display(), "could not remove the folder config's lock file");
    }
    Ok(Some(AdoptedFolderConfig {
        from,
        selection: moved?,
    }))
}

/// The default config when nothing has it yet, else a new profile.
fn choose_destination(
    folder: &Path,
    home: &MacrodHome,
    from: &Path,
) -> Result<ConfigSelection, AdoptError> {
    let default_config = home.default_config();
    let default_served = config::is_served(&default_config).map_err(|source| AdoptError::Move {
        from: from.to_owned(),
        to: default_config.clone(),
        source,
    })?;
    if !default_config.exists() && !default_served {
        return Ok(ConfigSelection::default_in(home));
    }
    let folder_name = folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let profile = home.first_unused_profile(&ProfileName::from_label(&folder_name), 1);
    Ok(ConfigSelection::profile_in(home, profile))
}

fn is_same_file(first: &Path, second: &Path) -> bool {
    match (std::fs::canonicalize(first), std::fs::canonicalize(second)) {
        (Ok(first), Ok(second)) => first == second,
        _ => false,
    }
}

/// Rename, or copy and remove across filesystems, keeping the file private:
/// it holds the harness credential.
fn move_private(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match std::fs::rename(from, to) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            std::fs::copy(from, to)?;
            restrict_to_owner(to)?;
            std::fs::remove_file(from)?;
        }
        Err(error) => return Err(error),
    }
    restrict_to_owner(to)
}

#[cfg(unix)]
fn restrict_to_owner(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Ask on the terminal for the profile a second runtime on this machine
/// should use, after `served` turned out to be taken. An empty answer takes
/// `suggestion`; `None` when input ends.
pub fn ask_for_profile(
    served: &Path,
    suggestion: &ProfileName,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> std::io::Result<Option<ProfileName>> {
    writeln!(
        output,
        "Another macrod is already running with {}.",
        served.display()
    )?;
    writeln!(
        output,
        "Start another runtime on this machine under a new profile (Ctrl-C to cancel)."
    )?;
    loop {
        write!(output, "Profile name [{suggestion}]: ")?;
        output.flush()?;
        let mut answer = String::new();
        if input.read_line(&mut answer)? == 0 {
            return Ok(None);
        }
        let answer = answer.trim();
        if answer.is_empty() {
            return Ok(Some(suggestion.clone()));
        }
        match answer.parse() {
            Ok(name) => return Ok(Some(name)),
            Err(error) => writeln!(output, "{error}")?,
        }
    }
}

/// One config `macrod profiles` lists.
#[derive(Debug, PartialEq, Eq)]
pub struct ListedConfig {
    /// `None` for the default config.
    pub profile: Option<ProfileName>,
    /// The config file.
    pub path: PathBuf,
    /// What the file says about pairing.
    pub pairing: Pairing,
    /// Whether a macrod holds it right now.
    pub serving: Serving,
}

/// A listed config's pairing.
#[derive(Debug, PartialEq, Eq)]
pub enum Pairing {
    /// No file yet (only the default config is listed without one).
    NoConfig,
    /// The file has no valid credential.
    NotPaired,
    /// Paired to this harness.
    Paired(HarnessId),
    /// The file does not load; `macrod` on it shows why.
    Invalid,
}

/// Whether a macrod is serving a listed config.
#[derive(Debug, PartialEq, Eq)]
pub enum Serving {
    /// A macrod holds its lock.
    Running,
    /// Nothing holds it.
    Stopped,
    /// The lock could not be probed.
    Unknown,
}

/// The default config and every profile, in that order.
pub fn list(home: &MacrodHome) -> std::io::Result<Vec<ListedConfig>> {
    let default = std::iter::once((None, home.default_config()));
    let profiles = home.profiles()?.into_iter().map(|profile| {
        let path = home.profile_config(&profile);
        (Some(profile), path)
    });
    Ok(default
        .chain(profiles)
        .map(|(profile, path)| ListedConfig {
            pairing: pairing_of(&path),
            serving: match config::is_served(&path) {
                Ok(true) => Serving::Running,
                Ok(false) => Serving::Stopped,
                Err(_) => Serving::Unknown,
            },
            profile,
            path,
        })
        .collect())
}

fn pairing_of(path: &Path) -> Pairing {
    if !path.exists() {
        return Pairing::NoConfig;
    }
    match Config::load(path) {
        Ok(config) => config
            .credentials
            .filter(HarnessCredentials::is_valid)
            .map_or(Pairing::NotPaired, |credentials| {
                Pairing::Paired(credentials.harness_id)
            }),
        Err(_) => Pairing::Invalid,
    }
}

/// `macrod profiles` output: one aligned row per config, under a header.
pub fn render(configs: &[ListedConfig]) -> String {
    let rows: Vec<[String; 4]> = configs
        .iter()
        .map(|listed| {
            [
                listed
                    .profile
                    .as_ref()
                    .map_or_else(|| "(default)".to_owned(), ProfileName::to_string),
                match listed.serving {
                    Serving::Running => "running",
                    Serving::Stopped => "stopped",
                    Serving::Unknown => "unknown",
                }
                .to_owned(),
                match &listed.pairing {
                    Pairing::NoConfig => "no config".to_owned(),
                    Pairing::NotPaired => "not paired".to_owned(),
                    Pairing::Paired(harness_id) => harness_id.to_string(),
                    Pairing::Invalid => "invalid config".to_owned(),
                },
                listed.path.display().to_string(),
            ]
        })
        .collect();
    let header = [
        "PROFILE".to_owned(),
        "MACROD".to_owned(),
        "HARNESS".to_owned(),
        "CONFIG".to_owned(),
    ];
    let mut widths = [0; 4];
    for row in std::iter::once(&header).chain(&rows) {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    let mut table = String::new();
    for row in std::iter::once(&header).chain(&rows) {
        let line = row
            .iter()
            .zip(widths)
            .map(|(cell, width)| format!("{cell:<width$}"))
            .collect::<Vec<_>>()
            .join("  ");
        table.push_str(line.trim_end());
        table.push('\n');
    }
    table
}
