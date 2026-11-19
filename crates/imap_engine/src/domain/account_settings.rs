//! Owner-visible server setup and mailbox-scoped folder routing preferences.
use super::discovery::discover;
use super::models::{Binding, Credentials, Endpoint, Error, Folder, FolderRole};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use utoipa::ToSchema;

/// Bound configuration preferences. They contain no login or message content.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderPreferences {
    /// Optimistic configuration version.
    pub revision: i64,
    /// Folder id to manually selected semantic role.
    pub role_overrides: BTreeMap<String, FolderRole>,
    /// Folders that should be listed without syncing their messages.
    pub excluded_folder_ids: BTreeSet<String>,
    /// At most one extra included folder may hold a live IDLE watcher.
    #[serde(default)]
    pub watched_folder_ids: BTreeSet<String>,
}

impl FolderPreferences {
    /// Discard references to folders absent from the current listing before resolving roles.
    /// For example, removal of a custom Sent destination restores the server's detected Sent folder.
    pub fn retain_listed<'a>(&mut self, ids: impl IntoIterator<Item = &'a str>) {
        let ids: BTreeSet<_> = ids.into_iter().collect();
        self.role_overrides
            .retain(|id, _| ids.contains(id.as_str()));
        self.excluded_folder_ids
            .retain(|id| ids.contains(id.as_str()));
        self.watched_folder_ids
            .retain(|id| ids.contains(id.as_str()));
    }

    /// Apply the configured semantic role to a listed folder, preserving the mandatory inbox.
    pub fn role(&self, folder: &Folder) -> FolderRole {
        configured_role(folder, &self.role_overrides)
    }
    /// An omitted folder stays visible in the catalog and can be included again.
    pub fn syncs(&self, folder_id: &str) -> bool {
        !self.excluded_folder_ids.contains(folder_id)
    }
}

fn configured_role(folder: &Folder, overrides: &BTreeMap<String, FolderRole>) -> FolderRole {
    if folder.role == FolderRole::Inbox {
        return FolderRole::Inbox;
    }
    if let Some(role) = overrides.get(&folder.id) {
        return *role;
    }
    // Assigning Archive to a custom folder displaces the automatic Archive.
    // Every role names at most one destination for filing a message.
    if folder.role != FolderRole::Other && overrides.values().any(|role| *role == folder.role) {
        return FolderRole::Other;
    }
    folder.role
}

/// One listed folder and its most recent sync selection, read from the same saved snapshot.
pub struct ObservedFolder {
    /// Listed folder with the original detected role.
    pub folder: Folder,
    /// Whether this folder was included in the latest synchronization.
    pub monitored: bool,
}

/// Folder name and the actual and configured routing roles, without message data.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FolderSetting {
    /// Whether this folder was included in the latest synchronization.
    #[serde(default = "super::models::default_monitored")]
    pub monitored: bool,
    /// Opaque identifier belonging to this account.
    pub id: String,
    /// Display name from the most recent listing.
    pub name: String,
    /// Automatic role before applying the user's override.
    pub detected_role: FolderRole,
    /// Resolved destination used by the engine.
    pub effective_role: FolderRole,
    /// Explicit user choice. An absent value uses the detected role.
    pub role_override: Option<FolderRole>,
    /// Whether the user has excluded this folder from message sync.
    pub excluded: bool,
    /// Whether this folder is selected for a dedicated watch.
    pub watched: bool,
}

/// Sanitized owner-only mailbox configuration. Endpoint has no password field.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccountMailSettings {
    /// Last verified server capabilities, when recorded at enrollment or reconnect.
    #[serde(default)]
    pub features: Option<super::server_features::ServerFeatures>,
    /// Incoming mail server, security mode and username.
    pub imap: Endpoint,
    /// Submission server, security mode and username.
    pub smtp: Endpoint,
    /// Version for compare-and-swap edits.
    pub revision: i64,
    /// Catalog name for the provider, when known.
    pub provider: Option<String>,
    /// Official instructions supplied by the catalog.
    pub help_url: Option<String>,
    /// Recently listed folders, including manually excluded folders.
    pub folders: Vec<FolderSetting>,
}

impl AccountMailSettings {
    /// Copy only an endpoint from each decrypted Login; neither credential value enters a DTO.
    pub fn new(
        c: &Credentials,
        folders: Vec<ObservedFolder>,
        prefs: &FolderPreferences,
    ) -> Result<Self, Error> {
        let catalog = discover(&c.email)?;
        let mut prefs = prefs.clone();
        prefs.retain_listed(folders.iter().map(|entry| entry.folder.id.as_str()));
        let folders = folders
            .into_iter()
            .map(|entry| {
                let folder = entry.folder;
                let effective_role = prefs.role(&folder);
                let excluded = !prefs.syncs(&folder.id);
                let role_override = prefs.role_overrides.get(&folder.id).copied();
                let watched = prefs.watched_folder_ids.contains(&folder.id);
                FolderSetting {
                    monitored: entry.monitored,
                    id: folder.id,
                    name: folder.name,
                    detected_role: folder.role,
                    effective_role,
                    role_override,
                    excluded,
                    watched,
                }
            })
            .collect();
        Ok(Self {
            features: c.features.clone(),
            imap: c.imap.endpoint.clone(),
            smtp: c.smtp.endpoint.clone(),
            revision: prefs.revision,
            provider: catalog.provider,
            help_url: catalog.help_url,
            folders,
        })
    }
}

/// Replace all routing overrides atomically. A stale revision returns a conflict.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateFolderSettings {
    /// Version returned by the last settings read.
    pub expected_revision: i64,
    /// Empty map restores automatic folder routing.
    pub role_overrides: BTreeMap<String, FolderRole>,
    /// Empty set re-enables all folders.
    pub excluded_folder_ids: BTreeSet<String>,
    /// At most one extra included folder may hold a live IDLE watcher.
    #[serde(default)]
    pub watched_folder_ids: BTreeSet<String>,
}

impl UpdateFolderSettings {
    /// Validate against this account's current folder catalog. No user can remap or omit INBOX.
    pub fn validate<'a>(&self, folders: impl IntoIterator<Item = &'a Folder>) -> Result<(), Error> {
        let catalog: BTreeMap<_, _> = folders.into_iter().map(|f| (f.id.as_str(), f)).collect();
        if self.expected_revision < 0
            || self.role_overrides.len() > catalog.len()
            || self.excluded_folder_ids.len() > catalog.len()
            || self.watched_folder_ids.len() > 1
        {
            return Err(Error::Invalid);
        }
        let mut roles = Vec::new();
        for (id, role) in &self.role_overrides {
            let folder = catalog.get(id.as_str()).ok_or(Error::Invalid)?;
            if folder.role == FolderRole::Inbox || *role == FolderRole::Inbox {
                return Err(Error::Invalid);
            }
            if *role != FolderRole::Other && roles.contains(role) {
                return Err(Error::Invalid);
            }
            roles.push(*role);
        }
        for id in &self.excluded_folder_ids {
            if catalog
                .get(id.as_str())
                .is_none_or(|folder| folder.role == FolderRole::Inbox)
            {
                return Err(Error::Invalid);
            }
        }
        for id in &self.watched_folder_ids {
            if self.excluded_folder_ids.contains(id)
                || catalog.get(id.as_str()).is_none_or(|folder| {
                    matches!(
                        configured_role(folder, &self.role_overrides),
                        FolderRole::Inbox | FolderRole::Drafts
                    )
                })
            {
                return Err(Error::Invalid);
            }
        }
        Ok(())
    }
}

/// Persist preferences and return the bounded observed folder list for the bound account.
#[async_trait]
pub trait SettingsRepository: Send + Sync {
    /// Read encrypted setup for an active owner binding, including when provider authentication has expired.
    async fn credentials_for_settings(&self, binding: Binding) -> Result<(String, Vec<u8>), Error>;
    /// Read preferences for the exact link and both generations.
    async fn preferences(&self, binding: Binding) -> Result<FolderPreferences, Error>;
    /// Read observed folders. Include excluded folders without retrieving their mail.
    async fn folders(&self, binding: Binding) -> Result<Vec<ObservedFolder>, Error>;
    /// Replace an exact version; reject updates after reconnect/removal/another editor.
    async fn update(&self, binding: Binding, settings: &UpdateFolderSettings)
    -> Result<i64, Error>;
}

#[cfg(test)]
mod test;
