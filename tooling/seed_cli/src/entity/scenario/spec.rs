//! Scenario config model: parsing, deterministic id derivation, and validation.
//!
//! A scenario file declares users, teams, channels, and entities with the
//! access edges between them, keyed by human-readable names. Every seeded row
//! id is derived from `(scenario, kind, key)` and carries the `5eed` marker
//! prefix so re-applying converges and resets can target exactly the seeded
//! rows.

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use models_permissions::share_permission::LinkShare;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Marker prefix (hex) carried by every seeded uuid.
pub const SEED_MARKER: &str = "5eed";

/// Access level names accepted in scenario share and link declarations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShareLevel {
    /// Read-only access.
    View,
    /// Read and comment access.
    Comment,
    /// Full edit access.
    Edit,
}

impl fmt::Display for ShareLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ShareLevel::View => f.write_str("view"),
            ShareLevel::Comment => f.write_str("comment"),
            ShareLevel::Edit => f.write_str("edit"),
        }
    }
}

fn check_link_share(
    errors: &mut Vec<String>,
    context: &str,
    link_share: Option<LinkShare>,
    link_share_access_level: Option<ShareLevel>,
) {
    match (link_share, link_share_access_level) {
        (Some(_), None) => errors.push(format!(
            "{context} sets link_share but not link_share_access_level"
        )),
        (None, Some(_)) => errors.push(format!(
            "{context} sets link_share_access_level but not link_share"
        )),
        _ => {}
    }
}

/// Team role names accepted in scenario team member declarations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamMemberRole {
    /// Regular team member.
    Member,
    /// Team admin.
    Admin,
}

/// Channel types accepted in scenario channel declarations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    /// Public channel: readable by everyone, joinable.
    Public,
    /// Private channel: participants only.
    Private,
    /// Two-person direct message.
    DirectMessage,
    /// Team channel: membership mirrors the team.
    Team,
}

/// A reference to another scenario object, written as `kind:key`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum EntityRef {
    /// A user by key.
    User(String),
    /// A team by key.
    Team(String),
    /// A channel by key.
    Channel(String),
    /// A document by key.
    Document(String),
    /// A project by key.
    Project(String),
    /// An AI chat by key.
    Chat(String),
    /// A call record by key.
    Call(String),
}

impl EntityRef {
    /// Parse a `kind:key` reference string.
    pub fn parse(raw: &str) -> Result<Self, String> {
        let (kind, key) = raw
            .split_once(':')
            .ok_or_else(|| format!("reference `{raw}` must look like `kind:key`"))?;
        if key.is_empty() {
            return Err(format!("reference `{raw}` has an empty key"));
        }
        let key = key.to_string();
        match kind {
            "user" => Ok(EntityRef::User(key)),
            "team" => Ok(EntityRef::Team(key)),
            "channel" => Ok(EntityRef::Channel(key)),
            "document" => Ok(EntityRef::Document(key)),
            "project" => Ok(EntityRef::Project(key)),
            "chat" => Ok(EntityRef::Chat(key)),
            "call" => Ok(EntityRef::Call(key)),
            other => Err(format!("reference `{raw}` has unknown kind `{other}`")),
        }
    }
}

/// A single share edge: grant `level` to the principal in `with`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShareSpec {
    /// The principal receiving access: `user:x`, `team:x`, or `channel:x`.
    pub with: String,
    /// The level granted.
    pub level: ShareLevel,
}

/// A user in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserSpec {
    /// Login email. With `run_local`'s passwordless FusionAuth this account
    /// is immediately log-in-able.
    pub email: String,
    /// First name shown in the app. Defaults to the capitalized key.
    #[serde(default)]
    pub first_name: Option<String>,
    /// Last name shown in the app. Defaults to "Seed".
    #[serde(default)]
    pub last_name: Option<String>,
    /// Extra role rows on top of the default `self_serve`. These drive
    /// feature entitlements like `read:professional_features`, not entity
    /// access. `professional_subscriber` = individually paid;
    /// `team_subscriber` + `sub_opus` = what joining a paying team grants
    /// (production keeps these in lockstep with team membership — the
    /// seeder lets you diverge on purpose).
    #[serde(default)]
    pub roles: Vec<String>,
}

/// A team in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TeamSpec {
    /// Display name. Defaults to the key.
    #[serde(default)]
    pub name: Option<String>,
    /// Team owner user key. Becomes `team_user` role `owner`.
    pub owner: String,
    /// Members and their roles (the owner is implicit).
    #[serde(default)]
    pub members: BTreeMap<String, TeamMemberRole>,
    /// Whether the team has CRM enabled.
    #[serde(default)]
    pub crm_enabled: bool,
}

/// A channel in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChannelSpec {
    /// Channel type.
    #[serde(rename = "type")]
    pub kind: ChannelKind,
    /// Display name. Defaults to the key for public/private/team channels;
    /// direct messages are unnamed.
    #[serde(default)]
    pub name: Option<String>,
    /// Owner user key. Required for public/private; derived for team
    /// channels (team owner); for DMs the first member is the owner.
    #[serde(default)]
    pub owner: Option<String>,
    /// Participant user keys (the owner is implicit). For team channels
    /// membership mirrors the team and this must be empty.
    #[serde(default)]
    pub members: Vec<String>,
    /// Backing team key. Required iff `type` is `team`.
    #[serde(default)]
    pub team: Option<String>,
}

/// A project in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectSpec {
    /// Owner user key.
    pub owner: String,
    /// Display name. Defaults to the key.
    #[serde(default)]
    pub name: Option<String>,
    /// Parent project key for nesting.
    #[serde(default)]
    pub parent: Option<String>,
    /// Access grants on the project (inherited by contained entities).
    #[serde(default)]
    pub share: Vec<ShareSpec>,
    /// Who can access the project through its share link.
    #[serde(default)]
    pub link_share: Option<LinkShare>,
    /// Access level granted through the share link.
    #[serde(default)]
    pub link_share_access_level: Option<ShareLevel>,
}

/// A document in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentSpec {
    /// Owner user key.
    pub owner: String,
    /// Display name. Defaults to the key.
    #[serde(default)]
    pub name: Option<String>,
    /// File name under `seed/documents/files/` providing the content.
    /// `.md` files are initialized as native sync-service documents; other
    /// extensions upload to object storage. Omit (along with `content`) for
    /// a name-only document row.
    #[serde(default)]
    pub file: Option<String>,
    /// Inline markdown content for a native document. Mutually exclusive
    /// with `file`.
    #[serde(default)]
    pub content: Option<String>,
    /// Project key this document lives in.
    #[serde(default)]
    pub project: Option<String>,
    /// Access grants on the document.
    #[serde(default)]
    pub share: Vec<ShareSpec>,
    /// Who can access the document through its share link.
    #[serde(default)]
    pub link_share: Option<LinkShare>,
    /// Access level granted through the share link.
    #[serde(default)]
    pub link_share_access_level: Option<ShareLevel>,
}

/// A task in the scenario: a markdown document with the task subtype plus
/// status/assignee properties.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskSpec {
    /// Owner user key.
    pub owner: String,
    /// Display name. Defaults to the key.
    #[serde(default)]
    pub name: Option<String>,
    /// Inline markdown body. Defaults to an empty document.
    #[serde(default)]
    pub content: Option<String>,
    /// Project key this task lives in.
    #[serde(default)]
    pub project: Option<String>,
    /// Status option: `not_started` (default), `in_progress`, `in_review`,
    /// `completed`, or `canceled`.
    #[serde(default)]
    pub status: Option<String>,
    /// Assignee user keys. Defaults to the owner.
    #[serde(default)]
    pub assignees: Vec<String>,
    /// Grant the owner's team comment access, like the app's
    /// share-with-team toggle on tasks.
    #[serde(default)]
    pub share_with_team: bool,
    /// Access grants on the task.
    #[serde(default)]
    pub share: Vec<ShareSpec>,
}

/// An AI chat in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatSpec {
    /// Owner user key.
    pub owner: String,
    /// Display name. Defaults to the key.
    #[serde(default)]
    pub name: Option<String>,
    /// Access grants on the chat.
    #[serde(default)]
    pub share: Vec<ShareSpec>,
    /// Who can access the chat through its share link.
    #[serde(default)]
    pub link_share: Option<LinkShare>,
    /// Access level granted through the share link.
    #[serde(default)]
    pub link_share_access_level: Option<ShareLevel>,
}

/// A transcript segment of a seeded call.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TranscriptSpec {
    /// Speaking user key (must be a participant).
    pub speaker: String,
    /// What was said.
    pub text: String,
}

/// An archived call record in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallSpec {
    /// Channel key the call happened in.
    pub channel: String,
    /// Creator user key (must have access to the channel).
    pub created_by: String,
    /// Grant the creator's team view access (mirrors the app default).
    #[serde(default = "default_true")]
    pub share_with_team: bool,
    /// Participant user keys. Defaults to just the creator.
    #[serde(default)]
    pub participants: Vec<String>,
    /// Call length in minutes. Defaults to 15.
    #[serde(default)]
    pub duration_minutes: Option<u32>,
    /// How long ago the call ended, in minutes. Defaults to staggered
    /// recent times.
    #[serde(default)]
    pub ended_minutes_ago: Option<u32>,
    /// Custom display name for the call record.
    #[serde(default)]
    pub name: Option<String>,
    /// Transcript segments.
    #[serde(default)]
    pub transcript: Vec<TranscriptSpec>,
}

fn default_true() -> bool {
    true
}

/// An email thread in a seeded inbox.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailThreadSpec {
    /// Subject line.
    pub subject: String,
    /// External sender email address.
    #[serde(default)]
    pub from: Option<String>,
    /// Plain-text body. Defaults to a short generated body.
    #[serde(default)]
    pub body: Option<String>,
    /// Raw HTML body. Apply runs it through [`email_utils::sanitize_email_html`]
    /// before writing `body_html_sanitized`. When omitted, the plaintext body
    /// is wrapped in a paragraph and sanitized.
    #[serde(default)]
    pub body_html: Option<String>,
    /// Whether the thread is unread.
    #[serde(default)]
    pub unread: bool,
    /// How long ago the message arrived, in minutes. Defaults to staggered
    /// recent times.
    #[serde(default)]
    pub sent_minutes_ago: Option<u32>,
    /// Access grants on the thread (beyond inbox ownership/delegation).
    #[serde(default)]
    pub share: Vec<ShareSpec>,
}

/// A connected inbox (email link) plus its threads.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailAccountSpec {
    /// Owner user key.
    pub owner: String,
    /// Mailbox address. Defaults to the owner's email.
    #[serde(default)]
    pub address: Option<String>,
    /// User keys this inbox is delegated to (shared-inbox access).
    #[serde(default)]
    pub delegated_to: Vec<String>,
    /// Threads keyed by a scenario-local name.
    #[serde(default)]
    pub threads: BTreeMap<String, EmailThreadSpec>,
}

/// A channel message in the scenario.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessageSpec {
    /// Channel key the message is posted to.
    pub channel: String,
    /// Sender user key (must be a channel member).
    pub from: String,
    /// Message text.
    pub text: String,
    /// Entity references mentioned by the message (`document:x`,
    /// `project:x`, `chat:x`, `call:x`, `user:x`). Mentioning a shareable
    /// entity grants the channel view access, like the app does.
    #[serde(default)]
    pub mentions: Vec<String>,
}

/// A full scenario file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioSpec {
    /// Scenario name: lowercase alphanumerics and hyphens. Namespaces all
    /// derived ids.
    pub scenario: String,
    /// Free-form description of what the scenario exercises.
    #[serde(default)]
    pub description: Option<String>,
    /// Users keyed by a short name.
    #[serde(default)]
    pub users: BTreeMap<String, UserSpec>,
    /// Teams keyed by a short name.
    #[serde(default)]
    pub teams: BTreeMap<String, TeamSpec>,
    /// Channels keyed by a short name.
    #[serde(default)]
    pub channels: BTreeMap<String, ChannelSpec>,
    /// Projects keyed by a short name.
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectSpec>,
    /// Documents keyed by a short name.
    #[serde(default)]
    pub documents: BTreeMap<String, DocumentSpec>,
    /// Tasks keyed by a short name.
    #[serde(default)]
    pub tasks: BTreeMap<String, TaskSpec>,
    /// AI chats keyed by a short name.
    #[serde(default)]
    pub chats: BTreeMap<String, ChatSpec>,
    /// Archived calls keyed by a short name.
    #[serde(default)]
    pub calls: BTreeMap<String, CallSpec>,
    /// Email inboxes keyed by a short name.
    #[serde(default)]
    pub emails: BTreeMap<String, EmailAccountSpec>,
    /// Channel messages, posted in order.
    #[serde(default)]
    pub messages: Vec<MessageSpec>,
}

/// Derive the deterministic uuid for `(scenario, kind, key)`.
///
/// Layout: bytes 0-1 are the `5eed` marker, bytes 2-3 hash the scenario
/// name, bytes 4-15 hash the full triple. Version/variant bits are set so
/// the result is a valid UUIDv8.
pub fn derive_id(scenario: &str, kind: &str, key: &str) -> Uuid {
    let mut bytes = [0u8; 16];
    bytes[0] = 0x5e;
    bytes[1] = 0xed;

    let scenario_hash = Sha256::digest(scenario.as_bytes());
    bytes[2..4].copy_from_slice(&scenario_hash[..2]);

    let mut hasher = Sha256::new();
    hasher.update(scenario.as_bytes());
    hasher.update([0]);
    hasher.update(kind.as_bytes());
    hasher.update([0]);
    hasher.update(key.as_bytes());
    let full_hash = hasher.finalize();
    bytes[4..16].copy_from_slice(&full_hash[..12]);

    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    Uuid::from_bytes(bytes)
}

/// The 8-hex-char id prefix shared by every row of a scenario.
pub fn scenario_marker(scenario: &str) -> String {
    let scenario_hash = Sha256::digest(scenario.as_bytes());
    format!(
        "{SEED_MARKER}{:02x}{:02x}",
        scenario_hash[0], scenario_hash[1]
    )
}

impl ScenarioSpec {
    /// Parse a scenario file and validate it.
    pub fn parse(content: &str) -> anyhow::Result<Self> {
        let spec: ScenarioSpec = serde_json::from_str(content)
            .map_err(|e| anyhow::anyhow!("invalid scenario json: {e}"))?;
        let errors = spec.validate();
        anyhow::ensure!(
            errors.is_empty(),
            "invalid scenario `{}`:\n  - {}",
            spec.scenario,
            errors.join("\n  - ")
        );
        Ok(spec)
    }

    /// The `macro|email` user id for a user key.
    pub fn user_id(&self, key: &str) -> String {
        format!("macro|{}", self.users[key].email)
    }

    /// The derived `macro_user` uuid for a user key.
    pub fn macro_user_uuid(&self, key: &str) -> Uuid {
        derive_id(&self.scenario, "macro_user", key)
    }

    /// The derived team uuid for a team key.
    pub fn team_id(&self, key: &str) -> Uuid {
        derive_id(&self.scenario, "team", key)
    }

    /// The derived channel uuid for a channel key.
    pub fn channel_id(&self, key: &str) -> Uuid {
        derive_id(&self.scenario, "channel", key)
    }

    /// The derived project id (text) for a project key.
    pub fn project_id(&self, key: &str) -> String {
        derive_id(&self.scenario, "project", key).to_string()
    }

    /// The derived document id (text) for a document key.
    pub fn document_id(&self, key: &str) -> String {
        derive_id(&self.scenario, "document", key).to_string()
    }

    /// The derived task document id (text) for a task key.
    pub fn task_id(&self, key: &str) -> String {
        derive_id(&self.scenario, "task", key).to_string()
    }

    /// The derived chat id (text) for a chat key.
    pub fn chat_id(&self, key: &str) -> String {
        derive_id(&self.scenario, "chat", key).to_string()
    }

    /// The derived call uuid for a call key.
    pub fn call_id(&self, key: &str) -> Uuid {
        derive_id(&self.scenario, "call", key)
    }

    /// The derived email link uuid for an inbox key.
    pub fn email_link_id(&self, key: &str) -> Uuid {
        derive_id(&self.scenario, "email_link", key)
    }

    /// The derived email thread uuid for `(inbox key, thread key)`.
    pub fn email_thread_id(&self, account: &str, thread: &str) -> Uuid {
        derive_id(
            &self.scenario,
            "email_thread",
            &format!("{account}/{thread}"),
        )
    }

    /// The derived email message uuid for `(inbox key, thread key)`.
    pub fn email_message_id(&self, account: &str, thread: &str) -> Uuid {
        derive_id(
            &self.scenario,
            "email_message",
            &format!("{account}/{thread}"),
        )
    }

    /// The derived channel message uuid for a message index.
    pub fn message_id(&self, index: usize) -> Uuid {
        derive_id(&self.scenario, "channel_message", &index.to_string())
    }

    /// The team a user key belongs to (owner or member), if any.
    pub fn team_of(&self, user_key: &str) -> Option<&str> {
        self.teams
            .iter()
            .find(|(_, team)| team.owner == user_key || team.members.contains_key(user_key))
            .map(|(key, _)| key.as_str())
    }

    /// All member user keys of a channel, owner included.
    pub fn channel_members(&self, channel_key: &str) -> Vec<String> {
        let channel = &self.channels[channel_key];
        let mut members: Vec<String> = Vec::new();
        match channel.kind {
            ChannelKind::Team => {
                let team = &self.teams[channel.team.as_deref().expect("validated")];
                members.push(team.owner.clone());
                members.extend(team.members.keys().cloned());
            }
            ChannelKind::DirectMessage => {
                members.extend(channel.members.iter().cloned());
            }
            ChannelKind::Public | ChannelKind::Private => {
                let owner = channel.owner.as_deref().expect("validated");
                members.push(owner.to_string());
                members.extend(channel.members.iter().filter(|m| *m != owner).cloned());
            }
        }
        let mut seen = BTreeSet::new();
        members.retain(|m| seen.insert(m.clone()));
        members
    }

    /// The owner user key of a channel.
    pub fn channel_owner(&self, channel_key: &str) -> String {
        let channel = &self.channels[channel_key];
        match channel.kind {
            ChannelKind::Team => self.teams[channel.team.as_deref().expect("validated")]
                .owner
                .clone(),
            ChannelKind::DirectMessage => channel.members[0].clone(),
            ChannelKind::Public | ChannelKind::Private => channel.owner.clone().expect("validated"),
        }
    }

    /// The chain of project keys from `project_key` up through its ancestors,
    /// starting with the project itself. Stops at unknown parents or cycles.
    pub fn project_chain(&self, project_key: &str) -> Vec<String> {
        let mut chain = vec![project_key.to_string()];
        let mut current = project_key;
        while let Some(parent) = self.projects[current].parent.as_deref() {
            if !self.projects.contains_key(parent) || chain.iter().any(|c| c == parent) {
                break;
            }
            chain.push(parent.to_string());
            current = parent;
        }
        chain
    }

    /// Validate the scenario, returning every problem found.
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        if self.scenario.is_empty()
            || !self
                .scenario
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            errors.push(format!(
                "scenario name `{}` must be non-empty lowercase alphanumerics/hyphens",
                self.scenario
            ));
        }

        let mut emails = BTreeSet::new();
        for (key, user) in &self.users {
            if !user.email.contains('@') || user.email != user.email.to_lowercase() {
                errors.push(format!(
                    "user `{key}` email `{}` must be a lowercase email address",
                    user.email
                ));
            }
            if !emails.insert(user.email.clone()) {
                errors.push(format!("user `{key}` reuses email `{}`", user.email));
            }
            for role in &user.roles {
                if role
                    .parse::<roles_and_permissions::domain::model::RoleId>()
                    .is_err()
                {
                    errors.push(format!("user `{key}` has unknown role `{role}`"));
                }
            }
        }

        let user_exists = |errors: &mut Vec<String>, context: &str, key: &str| {
            if !self.users.contains_key(key) {
                errors.push(format!("{context} references unknown user `{key}`"));
            }
        };

        let mut team_membership: BTreeMap<&str, &str> = BTreeMap::new();
        for (key, team) in &self.teams {
            user_exists(&mut errors, &format!("team `{key}` owner"), &team.owner);
            if team.members.contains_key(&team.owner) {
                errors.push(format!(
                    "team `{key}` lists its owner `{}` as a member; the owner is implicit",
                    team.owner
                ));
            }
            for member in team.members.keys() {
                user_exists(&mut errors, &format!("team `{key}` member"), member);
            }
            for user in std::iter::once(&team.owner).chain(team.members.keys()) {
                if let Some(previous) = team_membership.insert(user, key) {
                    errors.push(format!(
                        "user `{user}` is on both team `{previous}` and team `{key}`; users can only belong to one team"
                    ));
                }
            }
        }

        for (key, channel) in &self.channels {
            match channel.kind {
                ChannelKind::Team => {
                    match channel.team.as_deref() {
                        Some(team) if self.teams.contains_key(team) => {}
                        Some(team) => {
                            errors.push(format!("channel `{key}` references unknown team `{team}`"))
                        }
                        None => errors.push(format!("team channel `{key}` must set `team`")),
                    }
                    if channel.owner.is_some() || !channel.members.is_empty() {
                        errors.push(format!(
                            "team channel `{key}` derives owner/members from the team; leave them unset"
                        ));
                    }
                }
                ChannelKind::DirectMessage => {
                    if channel.members.len() != 2 || channel.members[0] == channel.members[1] {
                        errors.push(format!(
                            "direct message channel `{key}` must have exactly two distinct members"
                        ));
                    }
                    for member in &channel.members {
                        user_exists(&mut errors, &format!("channel `{key}` member"), member);
                    }
                    if channel.owner.is_some() || channel.name.is_some() {
                        errors.push(format!(
                            "direct message channel `{key}` cannot set owner or name"
                        ));
                    }
                    if channel.team.is_some() {
                        errors.push(format!(
                            "channel `{key}` sets `team` but is not a team channel"
                        ));
                    }
                }
                ChannelKind::Public | ChannelKind::Private => {
                    match channel.owner.as_deref() {
                        Some(owner) => {
                            user_exists(&mut errors, &format!("channel `{key}` owner"), owner)
                        }
                        None => errors.push(format!("channel `{key}` must set `owner`")),
                    }
                    for member in &channel.members {
                        user_exists(&mut errors, &format!("channel `{key}` member"), member);
                    }
                    if channel.team.is_some() {
                        errors.push(format!(
                            "channel `{key}` sets `team` but is not a team channel"
                        ));
                    }
                }
            }
        }

        let check_shares = |errors: &mut Vec<String>, context: &str, shares: &[ShareSpec]| {
            for share in shares {
                match EntityRef::parse(&share.with) {
                    Ok(EntityRef::User(user)) => {
                        user_exists(errors, &format!("{context} share"), &user)
                    }
                    Ok(EntityRef::Team(team)) => {
                        if !self.teams.contains_key(&team) {
                            errors
                                .push(format!("{context} share references unknown team `{team}`"));
                        }
                    }
                    Ok(EntityRef::Channel(channel)) => {
                        if !self.channels.contains_key(&channel) {
                            errors.push(format!(
                                "{context} share references unknown channel `{channel}`"
                            ));
                        }
                    }
                    Ok(other) => errors.push(format!(
                        "{context} share target must be a user, team, or channel (got {other:?})"
                    )),
                    Err(e) => errors.push(format!("{context} share: {e}")),
                }
            }
        };

        for (key, project) in &self.projects {
            user_exists(
                &mut errors,
                &format!("project `{key}` owner"),
                &project.owner,
            );
            if let Some(parent) = project.parent.as_deref()
                && !self.projects.contains_key(parent)
            {
                errors.push(format!(
                    "project `{key}` references unknown parent `{parent}`"
                ));
            }
            let context = format!("project `{key}`");
            check_shares(&mut errors, &context, &project.share);
            check_link_share(
                &mut errors,
                &context,
                project.link_share,
                project.link_share_access_level,
            );
        }

        for key in self.projects.keys() {
            let chain = self.project_chain(key);
            if let Some(last) = chain.last()
                && let Some(parent) = self.projects[last].parent.as_deref()
                && chain.iter().any(|c| c == parent)
            {
                errors.push(format!("project `{key}` is part of a parent cycle"));
            }
        }

        for (key, document) in &self.documents {
            user_exists(
                &mut errors,
                &format!("document `{key}` owner"),
                &document.owner,
            );
            if let Some(project) = document.project.as_deref()
                && !self.projects.contains_key(project)
            {
                errors.push(format!(
                    "document `{key}` references unknown project `{project}`"
                ));
            }
            if document.file.is_some() && document.content.is_some() {
                errors.push(format!(
                    "document `{key}` sets both `file` and `content`; pick one"
                ));
            }
            let context = format!("document `{key}`");
            check_shares(&mut errors, &context, &document.share);
            check_link_share(
                &mut errors,
                &context,
                document.link_share,
                document.link_share_access_level,
            );
        }

        for (key, task) in &self.tasks {
            user_exists(&mut errors, &format!("task `{key}` owner"), &task.owner);
            for assignee in &task.assignees {
                user_exists(&mut errors, &format!("task `{key}` assignee"), assignee);
            }
            if let Some(project) = task.project.as_deref()
                && !self.projects.contains_key(project)
            {
                errors.push(format!(
                    "task `{key}` references unknown project `{project}`"
                ));
            }
            if let Some(status) = task.status.as_deref()
                && system_properties::StatusOption::try_from(status).is_err()
            {
                errors.push(format!(
                    "task `{key}` has unknown status `{status}` (expected not_started, in_progress, in_review, completed, or canceled)"
                ));
            }
            if task.share_with_team
                && self.users.contains_key(&task.owner)
                && self.team_of(&task.owner).is_none()
            {
                errors.push(format!(
                    "task `{key}` sets share_with_team but owner `{}` is not on a team",
                    task.owner
                ));
            }
            check_shares(&mut errors, &format!("task `{key}`"), &task.share);
        }

        for (key, chat) in &self.chats {
            user_exists(&mut errors, &format!("chat `{key}` owner"), &chat.owner);
            let context = format!("chat `{key}`");
            check_shares(&mut errors, &context, &chat.share);
            check_link_share(
                &mut errors,
                &context,
                chat.link_share,
                chat.link_share_access_level,
            );
        }

        for (key, call) in &self.calls {
            let members = if self.channels.contains_key(&call.channel) {
                self.channel_members(&call.channel)
            } else {
                errors.push(format!(
                    "call `{key}` references unknown channel `{}`",
                    call.channel
                ));
                Vec::new()
            };
            user_exists(
                &mut errors,
                &format!("call `{key}` created_by"),
                &call.created_by,
            );
            if self.users.contains_key(&call.created_by)
                && !members.is_empty()
                && !members.contains(&call.created_by)
            {
                errors.push(format!(
                    "call `{key}` created_by `{}` is not a member of channel `{}`",
                    call.created_by, call.channel
                ));
            }
            for participant in &call.participants {
                user_exists(
                    &mut errors,
                    &format!("call `{key}` participant"),
                    participant,
                );
                if self.users.contains_key(participant)
                    && !members.is_empty()
                    && !members.contains(participant)
                {
                    errors.push(format!(
                        "call `{key}` participant `{participant}` is not a member of channel `{}`",
                        call.channel
                    ));
                }
            }
            let participants = self.call_participants(key);
            for segment in &call.transcript {
                if !participants.contains(&segment.speaker) {
                    errors.push(format!(
                        "call `{key}` transcript speaker `{}` is not a participant",
                        segment.speaker
                    ));
                }
            }
            if call.duration_minutes == Some(0) {
                errors.push(format!("call `{key}` duration_minutes must be positive"));
            }
        }

        for (key, account) in &self.emails {
            user_exists(&mut errors, &format!("inbox `{key}` owner"), &account.owner);
            for delegate in &account.delegated_to {
                user_exists(&mut errors, &format!("inbox `{key}` delegate"), delegate);
                if delegate == &account.owner {
                    errors.push(format!("inbox `{key}` cannot be delegated to its owner"));
                }
            }
            for (thread_key, thread) in &account.threads {
                if let Some(from) = thread.from.as_deref()
                    && !from.contains('@')
                {
                    errors.push(format!(
                        "inbox `{key}` thread `{thread_key}` sender `{from}` must be an email address"
                    ));
                }
                check_shares(
                    &mut errors,
                    &format!("inbox `{key}` thread `{thread_key}`"),
                    &thread.share,
                );
            }
        }

        for (index, message) in self.messages.iter().enumerate() {
            let context = format!("message #{index}");
            if !self.channels.contains_key(&message.channel) {
                errors.push(format!(
                    "{context} references unknown channel `{}`",
                    message.channel
                ));
            }
            user_exists(&mut errors, &format!("{context} sender"), &message.from);
            if self.channels.contains_key(&message.channel)
                && self.users.contains_key(&message.from)
                && !self
                    .channel_members(&message.channel)
                    .contains(&message.from)
            {
                errors.push(format!(
                    "{context} sender `{}` is not a member of channel `{}`",
                    message.from, message.channel
                ));
            }
            for mention in &message.mentions {
                match EntityRef::parse(mention) {
                    Ok(EntityRef::User(user)) => {
                        user_exists(&mut errors, &format!("{context} mention"), &user)
                    }
                    Ok(EntityRef::Document(doc)) => {
                        if !self.documents.contains_key(&doc) {
                            errors.push(format!(
                                "{context} mention references unknown document `{doc}`"
                            ));
                        }
                    }
                    Ok(EntityRef::Project(project)) => {
                        if !self.projects.contains_key(&project) {
                            errors.push(format!(
                                "{context} mention references unknown project `{project}`"
                            ));
                        }
                    }
                    Ok(EntityRef::Chat(chat)) => {
                        if !self.chats.contains_key(&chat) {
                            errors.push(format!("{context} mention references unknown chat `{chat}`"));
                        }
                    }
                    Ok(EntityRef::Call(call)) => {
                        if !self.calls.contains_key(&call) {
                            errors.push(format!("{context} mention references unknown call `{call}`"));
                        }
                    }
                    Ok(other) => errors.push(format!(
                        "{context} mention must be a user, document, project, chat, or call (got {other:?})"
                    )),
                    Err(e) => errors.push(format!("{context} mention: {e}")),
                }
            }
        }

        errors
    }

    /// The effective participant user keys of a call (creator included).
    pub fn call_participants(&self, call_key: &str) -> Vec<String> {
        let call = &self.calls[call_key];
        let mut participants = vec![call.created_by.clone()];
        participants.extend(
            call.participants
                .iter()
                .filter(|p| **p != call.created_by)
                .cloned(),
        );
        let mut seen = BTreeSet::new();
        participants.retain(|p| seen.insert(p.clone()));
        participants
    }
}
