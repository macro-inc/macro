//! Focused, comment-preserving edits to `macrod.toml`.

use std::path::{Path, PathBuf};

use rootcause::prelude::ResultExt as _;
use toml_edit::{DocumentMut, Item, value};

use super::agent_catalog::{DetectedAgent, name_for};
use crate::config::{Config, HarnessCredentials, IdentityScope};

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct DevMode;
    }
}

const DEFAULT_CONFIG: &str = include_str!("../../default.macrod.toml");
const DEV_API_URL: &str = "https://agent-harness-dev.macro.com";
const DEV_STORAGE_URL: &str = "https://dev-gateway.macro.com/dss";
const DEV_WEB_URL: &str = "https://dev.macro.com/app";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Deployment {
    Production,
    Development,
}

/// User-facing settings shown by the Config tab and Quickstart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Setting {
    /// Installed ACP agent to launch.
    Agent,
    /// Directory sessions run in.
    Workspace,
    /// Display name requested during pairing.
    Name,
    /// Private or team ownership requested during pairing.
    Scope,
}

impl Setting {
    /// Display label.
    pub fn label(self) -> &'static str {
        match self {
            Self::Agent => "Agent",
            Self::Workspace => "Workspace",
            Self::Name => "Name",
            Self::Scope => "Access",
        }
    }
}

/// Settings in keyboard navigation order.
pub const SETTINGS: &[Setting] = &[
    Setting::Agent,
    Setting::Workspace,
    Setting::Name,
    Setting::Scope,
];

/// The config document being viewed and edited.
pub struct ConfigForm {
    path: PathBuf,
    doc: DocumentMut,
}

impl ConfigForm {
    /// Load an existing config as an editable document.
    pub fn load(path: &Path) -> rootcause::Result<Self> {
        let raw = std::fs::read_to_string(path)
            .context(format!("failed to read config at {}", path.display()))?;
        let doc = raw
            .parse::<DocumentMut>()
            .context(format!("invalid TOML at {}", path.display()))?;
        Ok(Self {
            path: path.to_owned(),
            doc,
        })
    }

    /// Create a config from embedded defaults, selecting dev when `DEV_MODE` is present.
    pub fn create(path: &Path, agent: &DetectedAgent, workspace: &Path) -> rootcause::Result<()> {
        let deployment = if environment::DevMode::new().is_some() {
            Deployment::Development
        } else {
            Deployment::Production
        };
        Self::create_for_deployment(path, agent, workspace, deployment)
    }

    fn create_for_deployment(
        path: &Path,
        agent: &DetectedAgent,
        workspace: &Path,
        deployment: Deployment,
    ) -> rootcause::Result<()> {
        if !workspace.is_absolute() || !workspace.is_dir() {
            rootcause::bail!("the Quickstart workspace must be an existing absolute directory");
        }
        let doc = DEFAULT_CONFIG
            .parse::<DocumentMut>()
            .expect("the embedded macrod config template must be valid TOML");
        let mut form = Self {
            path: path.to_owned(),
            doc,
        };
        form.apply_agent(agent);
        form.set_string("workspace", "path", &workspace.to_string_lossy());
        if deployment == Deployment::Development {
            form.set_string("macro", "api_url", DEV_API_URL);
            form.set_string("macro", "storage_url", DEV_STORAGE_URL);
            form.set_string("macro", "web_url", DEV_WEB_URL);
        }
        form.save()
    }

    /// Display a user-facing setting from the validated config.
    pub fn display(&self, setting: Setting, config: &Config) -> String {
        match setting {
            Setting::Agent => name_for(&config.harness)
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Custom ({})", config.harness.command)),
            Setting::Workspace => config.workspace.path.display().to_string(),
            Setting::Name => config
                .identity
                .name
                .clone()
                .unwrap_or_else(|| "Hostname default".to_owned()),
            Setting::Scope => match config.identity.scope {
                crate::config::IdentityScope::Private => "Private".to_owned(),
                crate::config::IdentityScope::Team => "Team".to_owned(),
            },
        }
    }

    /// Current editable text for a setting that accepts typed input.
    pub fn edit_value(&self, setting: Setting) -> String {
        match setting {
            Setting::Workspace => self.string("workspace", "path").unwrap_or_default(),
            Setting::Name => self.string("identity", "name").unwrap_or_default(),
            Setting::Agent | Setting::Scope => String::new(),
        }
    }

    /// Apply typed input to a text setting.
    pub fn apply_text(&mut self, setting: Setting, input: &str) -> Result<(), String> {
        let input = input.trim();
        match setting {
            Setting::Workspace => {
                if input.is_empty() {
                    return Err("Workspace must not be empty".to_owned());
                }
                if !Path::new(input).is_absolute() {
                    return Err("Workspace must be an absolute path".to_owned());
                }
                if !Path::new(input).is_dir() {
                    return Err("Workspace must be an existing directory".to_owned());
                }
                self.set_string("workspace", "path", input);
            }
            Setting::Name => {
                if input.is_empty() {
                    self.remove("identity", "name");
                } else {
                    self.set_string("identity", "name", input);
                }
            }
            Setting::Agent | Setting::Scope => {
                return Err(format!("{} is selected rather than typed", setting.label()));
            }
        }
        Ok(())
    }

    /// Apply a detected agent's concrete launch specification.
    pub fn apply_agent(&mut self, agent: &DetectedAgent) {
        self.set_string("harness", "command", &agent.launch.command);
        let mut args = toml_edit::Array::new();
        for arg in &agent.launch.args {
            args.push(arg.as_str());
        }
        let section = self.doc["harness"].or_insert(toml_edit::table());
        section["args"] = value(args);
    }

    /// Apply Quickstart values to this document without replacing other settings.
    pub fn apply_quickstart(
        &mut self,
        agent: &DetectedAgent,
        workspace: &Path,
        scope: IdentityScope,
    ) {
        self.apply_agent(agent);
        self.set_string("workspace", "path", &workspace.to_string_lossy());
        self.set_scope(scope);
    }

    /// Toggle between private and team pairing scope.
    pub fn toggle_scope(&mut self, config: &Config) {
        let next = match config.identity.scope {
            crate::config::IdentityScope::Private => "team",
            crate::config::IdentityScope::Team => "private",
        };
        self.set_string("identity", "scope", next);
    }

    /// Set the requested scope without changing any approved credential scope.
    pub fn set_scope(&mut self, scope: IdentityScope) {
        let scope = match scope {
            IdentityScope::Private => "private",
            IdentityScope::Team => "team",
        };
        self.set_string("identity", "scope", scope);
    }

    /// Persist the credential minted by pairing in this config document.
    pub fn persist_credentials(
        &mut self,
        credentials: &HarnessCredentials,
    ) -> rootcause::Result<()> {
        self.set_string(
            "credentials",
            "harness_id",
            &credentials.harness_id.to_string(),
        );
        self.set_string("credentials", "token", &credentials.token);
        let scope = match credentials.scope {
            crate::config::HarnessScope::User => "user",
            crate::config::HarnessScope::Team => "team",
        };
        self.set_string("credentials", "scope", scope);
        self.save()
    }

    /// Remove the embedded credential while preserving the rest of the file.
    pub fn clear_credentials(&mut self) -> rootcause::Result<()> {
        self.doc.remove("credentials");
        self.save()
    }

    /// Validate the complete document and write it out.
    pub fn save(&self) -> rootcause::Result<()> {
        let rendered = self.doc.to_string();
        toml::from_str::<Config>(&rendered)
            .context("the edited config would not load; the value was rejected before writing")?;
        write_sensitive(&self.path, rendered.as_bytes())
            .context(format!("failed to write config at {}", self.path.display()))?;
        Ok(())
    }

    fn string(&self, section: &str, key: &str) -> Option<String> {
        self.doc
            .get(section)
            .and_then(|section| section.get(key))
            .and_then(Item::as_str)
            .map(str::to_owned)
    }

    fn set_string(&mut self, section: &str, key: &str, input: &str) {
        let section = self.doc[section].or_insert(toml_edit::table());
        section[key] = value(input);
    }

    fn remove(&mut self, section: &str, key: &str) {
        if let Some(table) = self.doc[section].as_table_like_mut() {
            table.remove(key);
        }
    }
}

fn write_sensitive(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
        options.mode(0o600);
        if path.exists() {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    let mut file = options.open(path)?;
    file.write_all(contents)
}
