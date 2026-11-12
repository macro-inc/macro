//! Bounded agent vault: authenticated agent principal, closed secret projection,
//! agent-only grant/approval policy and their wire models. Human vault types and
//! policy stay in `models`/`service`; nothing here widens a human route.
use super::models::{
    Error, ItemId, ItemKind, LoginUrl, Permission, Record, SecretString, SecretValues, TeamId,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

pub mod ports;
pub mod service;
pub(crate) mod totp;

#[cfg(test)]
pub(crate) mod test;

/// Facts the authoritative agent directory holds for the user behind an API key.
#[derive(Clone, Debug)]
pub struct DirectoryAgent {
    /// Agent account the key belongs to.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// Team the agent account belongs to.
    pub team_id: TeamId,
    /// Human responsible for the agent; never an implied item manager.
    pub owner_user_id: MacroUserIdStr<'static>,
    /// Whether the agent account is currently enabled.
    pub enabled: bool,
    /// Whether the agent's computer runtime is live and not destroyed.
    pub computer_live: bool,
}

/// Untrusted wake correlation: a UUIDv7 inside the accepted time window.
/// It authorizes nothing and proves no session or process binding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WakeId(pub Uuid);

/// An agent the directory currently admits to one team. Only the agent service
/// constructs it, after flags and directory admission.
#[derive(Clone, Debug)]
pub struct AdmittedAgent {
    pub(super) agent_user_id: MacroUserIdStr<'static>,
    pub(super) team: TeamId,
    pub(super) wake: WakeId,
}
impl AdmittedAgent {
    /// Authenticated agent account.
    pub fn agent_user_id(&self) -> &MacroUserIdStr<'static> {
        &self.agent_user_id
    }
    /// Admitted team.
    pub fn team(&self) -> TeamId {
        self.team
    }
    /// Untrusted wake correlation recorded in audit and traces.
    pub fn wake(&self) -> WakeId {
        self.wake
    }
}

/// Login item fields an agent may select.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentLoginField)]
pub enum LoginField {
    /// The stored username slot.
    Username,
    /// The stored password slot.
    Password,
}

/// API credential fields an agent may select.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentApiField)]
pub enum ApiField {
    /// The API key, stored in the username slot.
    Key,
    /// The API secret, stored in the password slot.
    Secret,
}

/// Closed kind-aware selector of exactly one stored slot. Notes, custom fields
/// and TOTP seeds are never selectable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[schema(as = PasswordAgentSecretSelector)]
pub enum SecretSelector {
    /// A login item field.
    Login {
        /// Selected login field.
        field: LoginField,
    },
    /// An API credential field.
    Api {
        /// Selected API credential field.
        field: ApiField,
    },
}

/// The provider slot a selector projects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    Username,
    Password,
}

impl SecretSelector {
    pub(crate) fn slot(self) -> Slot {
        match self {
            Self::Login {
                field: LoginField::Username,
            }
            | Self::Api {
                field: ApiField::Key,
            } => Slot::Username,
            Self::Login {
                field: LoginField::Password,
            }
            | Self::Api {
                field: ApiField::Secret,
            } => Slot::Password,
        }
    }
    pub(crate) fn kind(self) -> AgentKind {
        match self {
            Self::Login { .. } => AgentKind::Login,
            Self::Api { .. } => AgentKind::Api,
        }
    }
}

/// The two stored kinds agents may disclose or write in v1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentKind {
    Login,
    Api,
}
impl AgentKind {
    /// Classify a stored kind; every other kind is unsupported for agent values.
    pub(crate) fn of(kind: &ItemKind) -> Result<Self, AgentError> {
        match kind {
            ItemKind::Login => Ok(Self::Login),
            ItemKind::Api => Ok(Self::Api),
            ItemKind::Card | ItemKind::Note | ItemKind::Identity | ItemKind::VerificationCode => {
                Err(AgentError::UnsupportedKind)
            }
        }
    }
    pub(crate) fn item_kind(self) -> ItemKind {
        match self {
            Self::Login => ItemKind::Login,
            Self::Api => ItemKind::Api,
        }
    }
}

/// New item values; the item kind is this tag.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[schema(as = PasswordAgentCreateSecret)]
pub enum AgentCreateSecret {
    /// A website or application login.
    Login {
        /// Optional username; omitted stores an empty slot.
        #[serde(default)]
        username: Option<SecretString>,
        /// Required non-empty password.
        password: SecretString,
    },
    /// An API credential.
    Api {
        /// Optional API key; omitted stores an empty slot.
        #[serde(default)]
        key: Option<SecretString>,
        /// Required non-empty API secret.
        secret: SecretString,
    },
}
impl AgentCreateSecret {
    pub(crate) fn kind(&self) -> AgentKind {
        match self {
            Self::Login { .. } => AgentKind::Login,
            Self::Api { .. } => AgentKind::Api,
        }
    }
    /// Map onto the stored slots with empty notes and no custom fields.
    pub(crate) fn into_values(self) -> Result<SecretValues, AgentError> {
        let (username, password) = match self {
            Self::Login { username, password } => (username, password),
            Self::Api { key, secret } => (key, secret),
        };
        let username = username.unwrap_or(SecretString(String::new()));
        if password.0.is_empty() || password.0.len() > MAX_SLOT || username.0.len() > MAX_SLOT {
            return Err(AgentError::Invalid);
        }
        Ok(SecretValues {
            username,
            password,
            notes: SecretString(String::new()),
            fields: vec![],
        })
    }
}

/// Replacement of supplied slots; absent slots keep their stored value.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
#[schema(as = PasswordAgentSecretPatch)]
pub enum AgentSecretPatch {
    /// Login slots to replace.
    Login {
        /// New username.
        #[serde(default)]
        username: Option<SecretString>,
        /// New password.
        #[serde(default)]
        password: Option<SecretString>,
    },
    /// API credential slots to replace.
    Api {
        /// New API key.
        #[serde(default)]
        key: Option<SecretString>,
        /// New API secret.
        #[serde(default)]
        secret: Option<SecretString>,
    },
}
impl AgentSecretPatch {
    pub(crate) fn kind(&self) -> AgentKind {
        match self {
            Self::Login { .. } => AgentKind::Login,
            Self::Api { .. } => AgentKind::Api,
        }
    }
    /// Replace only the supplied slots of the committed values. Notes, custom
    /// fields and their order are left exactly as stored.
    pub(crate) fn apply(self, values: &mut SecretValues) -> Result<(), AgentError> {
        let (username, password) = match self {
            Self::Login { username, password } => (username, password),
            Self::Api { key, secret } => (key, secret),
        };
        for value in [&username, &password].into_iter().flatten() {
            if value.0.is_empty() || value.0.len() > MAX_SLOT {
                return Err(AgentError::Invalid);
            }
        }
        if let Some(username) = username {
            values.username = username;
        }
        if let Some(password) = password {
            values.password = password;
        }
        Ok(())
    }
}

/// Largest accepted slot, matching the human v1 bound.
const MAX_SLOT: usize = 65536;

/// Agent-editable display fields.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentEditableMetadata)]
pub struct AgentEditableMetadata {
    /// New display name.
    #[serde(default)]
    pub name: Option<String>,
    /// New URL; null clears it, absent keeps it.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>, nullable)]
    pub url: Option<Option<LoginUrl>>,
}
fn present<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<LoginUrl>>, D::Error> {
    Option::<LoginUrl>::deserialize(deserializer).map(Some)
}

/// Accepted disclosure intent. Typing is a later additive value.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentPurpose)]
pub enum AgentPurpose {
    /// The capability places the value on the clipboard.
    Copy,
}

/// One-field disclosure request.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentDiscloseRequest)]
pub struct DiscloseRequest {
    /// The single slot to disclose.
    pub selector: SecretSelector,
    /// Audited intent.
    pub purpose: AgentPurpose,
    /// When given, the committed version must match.
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// One disclosed field.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentDisclosed)]
pub struct Disclosed {
    /// The selected value.
    pub value: SecretString,
    /// Committed version it was read from.
    pub version: i32,
    /// The selector that was disclosed.
    pub selector: SecretSelector,
}

/// Verification-code request.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentTotpCodeRequest)]
pub struct TotpCodeRequest {
    /// Audited intent.
    pub purpose: AgentPurpose,
}

/// A verification code with a conservative server-computed lifetime.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentTotpCode)]
pub struct AgentTotpCode {
    /// Current code; never the seed.
    pub code: SecretString,
    /// Conservative usable-until time under the documented provider clock bound;
    /// not an observed generation instant.
    pub expires_at: DateTime<Utc>,
    /// Code period in seconds.
    pub period_seconds: u32,
    /// Whole milliseconds from the server's final check until `expiresAt`.
    pub valid_for_ms: u64,
}

/// Agent item creation; the kind is the secret's tag.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentCreateItem)]
pub struct AgentCreateItem {
    /// UUIDv7, stable across retries; becomes the item id.
    pub operation_id: Uuid,
    /// Display name.
    pub name: String,
    /// Optional website URL.
    #[serde(default)]
    pub url: Option<LoginUrl>,
    /// Typed values.
    pub secret: AgentCreateSecret,
}

/// Agent item update.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentPatchItem)]
pub struct AgentPatchItem {
    /// UUIDv7, stable across retries of this one update.
    pub operation_id: Uuid,
    /// Committed version the update applies to.
    pub expected_version: i32,
    /// Slots to replace.
    #[serde(default)]
    pub secret_patch: Option<AgentSecretPatch>,
    /// Display fields to replace.
    #[serde(default)]
    pub metadata_patch: Option<AgentEditableMetadata>,
}

/// Verification-code seed setup for an item the agent created.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentSetTotp)]
pub struct AgentSetTotp {
    /// UUIDv7, stable across retries; identifies the enrollment generation.
    pub operation_id: Uuid,
    /// Committed version the setup applies to.
    pub expected_version: i32,
    /// Base32 seed.
    pub seed: SecretString,
}

/// Access request body.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentAccessRequestBody)]
pub struct AccessRequestBody {
    /// Requested permission.
    pub permission: Permission,
}

/// Whether the agent can use an item now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentAccessStatus)]
pub enum AccessStatus {
    /// The agent can use the item.
    Usable,
    /// No live request; the agent may request access.
    RequestAccess,
    /// A request awaits an authorized human.
    Pending,
}

/// Why a usable item is usable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentUseBasis)]
pub enum UseBasis {
    /// The agent created the item and holds its current grant.
    CreatorGrant,
    /// An authorized human granted and approved the agent.
    ApprovedGrant,
}

/// Current agent access to one item, recomputed on every use.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentItemAccess)]
pub struct AgentItemAccess {
    /// Current status.
    pub status: AccessStatus,
    /// Basis of use when usable.
    pub use_basis: Option<UseBasis>,
    /// Whether the agent may update values and metadata.
    pub can_update: bool,
    /// Whether the agent may enroll a verification-code seed.
    pub can_set_totp: bool,
    /// Revision of this agent's grant/approval on the item.
    pub permission_revision: i64,
    /// Live request awaiting review.
    pub pending_request_id: Option<Uuid>,
}

/// Metadata-only search hit; never values, usernames, notes or custom fields.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentSearchHit)]
pub struct AgentSearchHit {
    /// Item id.
    pub id: ItemId,
    /// Display name.
    pub name: String,
    /// Stored kind.
    pub kind: ItemKind,
    /// Website URL.
    pub url: Option<String>,
    /// Committed positive version.
    pub version: i32,
    /// Current access.
    pub access: AgentItemAccess,
}

/// One search page.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentSearchPage)]
pub struct AgentSearchPage {
    /// Hits, newest first.
    pub items: Vec<AgentSearchHit>,
    /// Opaque cursor of the next page.
    pub next_cursor: Option<String>,
}

/// Created or updated item.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentWriteResult)]
pub struct AgentWriteResult {
    /// Item after the write.
    pub item: AgentSearchHit,
    /// Committed version.
    pub version: i32,
}

/// Stored request lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoredRequestStatus {
    /// Awaiting review.
    Pending,
    /// Approved with a grant.
    Approved,
    /// Denied.
    Denied,
    /// Approved, then revoked.
    Revoked,
}

/// Wire request status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentRequestStatus)]
pub enum RequestStatus {
    /// No request exists.
    None,
    /// Awaiting review.
    Pending,
    /// Approved with a grant.
    Approved,
    /// Denied.
    Denied,
    /// Approved, then revoked.
    Revoked,
}
impl From<StoredRequestStatus> for RequestStatus {
    fn from(status: StoredRequestStatus) -> Self {
        match status {
            StoredRequestStatus::Pending => Self::Pending,
            StoredRequestStatus::Approved => Self::Approved,
            StoredRequestStatus::Denied => Self::Denied,
            StoredRequestStatus::Revoked => Self::Revoked,
        }
    }
}

/// The latest request of one agent for one item.
#[derive(Clone, Debug)]
pub struct StoredRequest {
    /// Request id, new for every new request.
    pub id: Uuid,
    /// Requested or granted permission.
    pub permission: Permission,
    /// Lifecycle state.
    pub status: StoredRequestStatus,
    /// Revision guarding resolution.
    pub revision: i64,
    /// Last transition.
    pub updated_at: DateTime<Utc>,
}

/// Stored approval and request facts of one agent on one item.
#[derive(Clone, Debug, Default)]
pub struct AgentAccessRow {
    /// Standing approval by an authorized human.
    pub approved: bool,
    /// Revision of the grant/approval, advanced by every change.
    pub permission_revision: i64,
    /// Latest request.
    pub request: Option<StoredRequest>,
}

/// An agent's request state.
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentAccessRequestState)]
pub struct AgentAccessRequestState {
    /// Request id; null when none exists.
    pub request_id: Option<Uuid>,
    /// Item id.
    pub item_id: ItemId,
    /// Agent account.
    #[schema(value_type = String)]
    pub agent_account_id: MacroUserIdStr<'static>,
    /// Requested permission; null when none exists.
    pub permission: Option<Permission>,
    /// Request status.
    pub status: RequestStatus,
    /// Request revision; 0 when none exists.
    pub revision: i64,
    /// Current access.
    pub access: AgentItemAccess,
    /// Last transition.
    pub updated_at: Option<DateTime<Utc>>,
}

/// A page of requests for human review.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = PasswordAgentAccessRequestPage)]
pub struct AgentAccessRequestPage {
    /// Pending requests on items the caller may manage.
    pub requests: Vec<AgentAccessRequestState>,
    /// Opaque cursor of the next page.
    pub next_cursor: Option<String>,
}

/// Human decision on a pending request.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(tag = "decision", rename_all = "snake_case", deny_unknown_fields)]
#[schema(as = PasswordAgentResolveRequest)]
pub enum ResolveRequest {
    /// Grant the permission and standing approval together.
    Approve {
        /// Request revision observed by the reviewer.
        revision: i64,
        /// Granted permission.
        permission: Permission,
    },
    /// Deny the request.
    Deny {
        /// Request revision observed by the reviewer.
        revision: i64,
    },
}

/// What a revocation removes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = PasswordAgentRevokeScope)]
pub enum RevokeScope {
    /// Standing approval only; a shared grant then needs a new approval.
    Approval,
    /// The Agent grant and its approval.
    GrantAndApproval,
}

/// Human revocation of agent access.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PasswordAgentRevokeBody)]
pub struct RevokeBody {
    /// Permission revision observed by the reviewer.
    pub expected_permission_revision: i64,
    /// What to remove.
    pub scope: RevokeScope,
}

/// Fixed agent audit actions; never derived from values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAction {
    /// Item metadata returned by search.
    AgentSearchHit,
    /// One field disclosed.
    AgentDisclose,
    /// Verification code disclosed.
    AgentTotpCode,
    /// Item created.
    AgentCreate,
    /// Item updated.
    AgentUpdate,
    /// Verification-code seed enrolled.
    AgentTotpSetup,
    /// New access request.
    AgentAccessRequest,
    /// Human approved a request.
    AgentAccessApprove,
    /// Human denied a request.
    AgentAccessDeny,
    /// Human revoked access.
    AgentAccessRevoke,
}

/// Sanitized agent failures; payload-free except the typed retry hint.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("not found")]
    /// Feature off, or outside the admitted catalog.
    NotFound,
    #[error("invalid agent")]
    /// The directory does not currently admit this agent to the team.
    InvalidAgent,
    #[error("invalid session attribution")]
    /// Wake correlation is missing or malformed.
    InvalidSessionAttribution,
    #[error("not granted")]
    /// No current qualifying Agent grant.
    NotGranted,
    #[error("pending")]
    /// Awaiting standing approval or review.
    Pending,
    #[error("forbidden")]
    /// The operation needs a capability the agent lacks.
    Forbidden,
    #[error("invalid request")]
    /// Invalid body, selector or value.
    Invalid,
    #[error("unsupported kind")]
    /// Agents cannot disclose or write this item kind.
    UnsupportedKind,
    #[error("field not set")]
    /// The selected slot is empty.
    FieldNotSet,
    #[error("version conflict")]
    /// The committed version or revision changed.
    Conflict,
    #[error("vault busy")]
    /// Lease contention; retry with backoff.
    Busy,
    #[error("rate limited")]
    /// Too many requests; retry after the hint.
    RateLimited {
        /// Milliseconds until a retry can be accepted.
        retry_after_ms: u64,
    },
    #[error("vault unavailable")]
    /// A dependency is unavailable or the deadline elapsed.
    Unavailable,
}
impl From<Error> for AgentError {
    fn from(error: Error) -> Self {
        match error {
            Error::NotFound => Self::NotFound,
            Error::Forbidden => Self::Forbidden,
            Error::Invalid => Self::Invalid,
            Error::Conflict | Error::FolderMissing => Self::Conflict,
            Error::Busy => Self::Busy,
            Error::Unavailable => Self::Unavailable,
        }
    }
}

/// Current policy facts of one agent on one item.
///
/// `G` is a current Agent grant, `C` creator attribution and `A` standing
/// approval: the agent can use the item when `G && (C || A)`. Human, team and
/// folder grants never count.
#[derive(Clone, Debug)]
pub(crate) struct AgentPolicy {
    pub grant: Option<Permission>,
    pub creator: bool,
    pub approved: bool,
    pub pending_request: Option<Uuid>,
    pub permission_revision: i64,
}
impl AgentPolicy {
    /// Human item stage rejects agent publishers, so a record whose creator is
    /// this agent account was created through the agent path.
    pub(crate) fn of(
        record: &Record,
        agent: &MacroUserIdStr<'_>,
        row: Option<&AgentAccessRow>,
    ) -> Self {
        let grant = record
            .grants
            .iter()
            .find(|grant| {
                matches!(grant.kind, super::models::GranteeKind::Agent)
                    && grant.id == agent.as_ref()
            })
            .map(|grant| grant.permission);
        Self {
            grant,
            creator: record.user_id.as_ref() == agent.as_ref(),
            approved: row.is_some_and(|row| row.approved),
            pending_request: row
                .and_then(|row| row.request.as_ref())
                .filter(|request| request.status == StoredRequestStatus::Pending)
                .map(|request| request.id),
            permission_revision: row.map_or(0, |row| row.permission_revision),
        }
    }
    fn can_use(&self) -> bool {
        self.grant.is_some() && (self.creator || self.approved)
    }
    /// Admit a use with the contract's exact precedence: a creator without a
    /// current grant is `not_granted` even while a request is pending.
    pub(crate) fn require_use(&self) -> Result<UseBasis, AgentError> {
        if self.creator && self.grant.is_none() {
            return Err(AgentError::NotGranted);
        }
        if self.can_use() {
            return Ok(if self.creator {
                UseBasis::CreatorGrant
            } else {
                UseBasis::ApprovedGrant
            });
        }
        if self.pending_request.is_some() || self.grant.is_some() {
            return Err(AgentError::Pending);
        }
        Err(AgentError::NotGranted)
    }
    pub(crate) fn require_update(&self) -> Result<(), AgentError> {
        self.require_use()?;
        if self.grant != Some(Permission::Edit) {
            return Err(AgentError::Forbidden);
        }
        Ok(())
    }
    pub(crate) fn require_totp_setup(&self) -> Result<(), AgentError> {
        self.require_update()?;
        if !self.creator {
            return Err(AgentError::Forbidden);
        }
        Ok(())
    }
    pub(crate) fn access(&self) -> AgentItemAccess {
        let usable = self.can_use();
        let edit = usable && self.grant == Some(Permission::Edit);
        AgentItemAccess {
            status: if usable {
                AccessStatus::Usable
            } else if self.pending_request.is_some() {
                AccessStatus::Pending
            } else {
                AccessStatus::RequestAccess
            },
            use_basis: match (usable, self.creator) {
                (false, _) => None,
                (true, true) => Some(UseBasis::CreatorGrant),
                (true, false) => Some(UseBasis::ApprovedGrant),
            },
            can_update: edit,
            can_set_totp: edit && self.creator,
            permission_revision: self.permission_revision,
            pending_request_id: if usable { None } else { self.pending_request },
        }
    }
}

/// An agent may discover and request a live item shared with its team, or one
/// it holds a grant on or created. Private human items stay invisible to agents.
pub(crate) fn requestable(record: &Record, agent: &MacroUserIdStr<'_>) -> bool {
    use super::models::GranteeKind;
    !record.deleting
        && (record.user_id.as_ref() == agent.as_ref()
            || record.grants.iter().any(|grant| match grant.kind {
                GranteeKind::Team => grant.id == record.metadata.team_id.0.to_string(),
                GranteeKind::Agent => grant.id == agent.as_ref(),
                GranteeKind::User => false,
            }))
}

/// Item hit with access recomputed from current policy facts.
pub(crate) fn hit(record: &Record, policy: &AgentPolicy) -> AgentSearchHit {
    AgentSearchHit {
        id: record.metadata.id,
        name: record.metadata.name.clone(),
        kind: record.metadata.kind.clone(),
        url: record.metadata.url.clone().map(String::from),
        version: record.metadata.version,
        access: policy.access(),
    }
}

/// Request state for the wire, with `none` when no request exists.
pub(crate) fn request_state(
    item: ItemId,
    agent: &MacroUserIdStr<'static>,
    row: Option<&AgentAccessRow>,
    policy: &AgentPolicy,
) -> AgentAccessRequestState {
    let request = row.and_then(|row| row.request.as_ref());
    AgentAccessRequestState {
        request_id: request.map(|request| request.id),
        item_id: item,
        agent_account_id: agent.clone(),
        permission: request.map(|request| request.permission),
        status: request.map_or(RequestStatus::None, |request| request.status.into()),
        revision: request.map_or(0, |request| request.revision),
        access: policy.access(),
        updated_at: request.map(|request| request.updated_at),
    }
}
