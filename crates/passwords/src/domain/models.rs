//! Validated vault identities and metadata; secret buffers erase themselves on drop.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Vault item identity, UUIDv7 for new items.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(transparent)]
#[schema(as=PasswordItemId)]
pub struct ItemId(
    /// Validated UUID identifying a vault item.
    pub Uuid,
);

/// Team isolation boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(transparent)]
#[schema(as=PasswordTeamId)]
pub struct TeamId(
    /// Validated UUID identifying a Macro team.
    pub Uuid,
);

/// Authenticated human identity. Constructed by the authentication adapter.
#[derive(Clone)]
pub struct Actor {
    /// Authenticated Macro user identity; never a provider credential.
    pub user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
}

/// Owned sensitive text. Deliberately does not implement Debug or Display.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop, utoipa::ToSchema)]
#[serde(transparent)]
#[schema(as=PasswordSecretString)]
pub struct SecretString(
    /// Sensitive owned text; do not log, debug, or persist outside the provider.
    pub String,
);

/// Secret payload; never persisted in the metadata database or traced.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordSecretValues)]
pub struct SecretValues {
    /// Account identifier; authorized humans may resolve it separately from confidential values.
    pub username: SecretString,
    /// Private credential, zeroized when the owned buffer is dropped.
    pub password: SecretString,
    /// Private free-form notes, stored only by the secret provider.
    pub notes: SecretString,
    /// Additional private fields, including their labels.
    pub fields: Vec<SecretField>,
}

/// One private custom field.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
#[schema(as=PasswordSecretField)]
pub struct SecretField {
    /// Private field label, stored alongside its value in OpenBao.
    pub label: String,
    /// Private field content.
    pub value: SecretString,
}

/// Product template. Values use the same protected representation for every template.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as=PasswordItemKind)]
pub enum ItemKind {
    /// Website or application login.
    Login,
    /// Payment-card template.
    Card,
    /// Private note template.
    Note,
    /// Identity-document template.
    Identity,
    /// API credential template.
    Api,
    /// Standalone time-based verification code for an account kept elsewhere.
    VerificationCode,
}

/// Searchable display fields, without any credential values.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordItemFields)]
pub struct ItemMetadata {
    /// Identity of this resource within its team.
    pub id: ItemId,
    /// Team namespace and authorization boundary.
    pub team_id: TeamId,
    /// Searchable display name; must not contain credential values.
    pub name: String,
    /// Item template or grantee category.
    pub kind: ItemKind,
    /// Optional searchable website URL, without embedded credentials.
    pub url: Option<LoginUrl>,
    /// Optional folder belonging to this same team.
    pub folder_id: Option<Uuid>,
    /// Whether the item is marked as a favorite.
    pub favorite: bool,
    /// Committed provider value version.
    pub version: i32,
    /// Whether the item has an enrolled verification-code seed.
    pub has_totp: bool,
    /// Whether the item currently has explicit grants.
    pub shared: bool,
    /// Number of distinct explicitly shared recipients; a team grant counts once.
    #[serde(default)]
    #[schema(required)]
    pub share_count: usize,
    /// Resource creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Most recent metadata modification timestamp.
    pub updated_at: DateTime<Utc>,
    /// Most recent protected disclosure timestamp, when available.
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Actor-specific response capabilities, never part of persisted metadata or write intents.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordItemMetadata)]
pub struct ItemView {
    /// Stored display fields, without confidential values or derived authority.
    #[serde(flatten)]
    pub metadata: ItemMetadata,
    /// Whether this caller may change grants or delete the team item now.
    pub can_manage: bool,
    /// Whether this caller may edit item fields or verification-code enrollment now.
    pub can_edit: bool,
    /// Whether the team has an explicit grant, independent of direct recipients.
    pub shared_with_team: bool,
}
impl std::ops::Deref for ItemView {
    type Target = ItemMetadata;
    fn deref(&self) -> &Self::Target {
        &self.metadata
    }
}

/// Mutation without provider-specific representations.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordWriteItem)]
pub struct WriteItem {
    /// UUIDv7 identifying one logical save across uncertain retries.
    pub operation_id: Uuid,
    /// Searchable display name; must not contain credential values.
    pub name: String,
    /// Item template or grantee category.
    pub kind: ItemKind,
    /// Optional searchable website URL, without embedded credentials.
    pub url: Option<LoginUrl>,
    /// Optional folder belonging to this same team.
    pub folder_id: Option<Uuid>,
    /// Whether the item is marked as a favorite.
    pub favorite: bool,
    /// Create without the default team edit grant. Updates preserve existing grants.
    #[serde(default)]
    pub private: bool,
    /// Version observed by the editor; absent only for creation.
    pub expected_version: Option<i32>,
    /// Private payload; never serialize into the metadata repository.
    pub values: SecretValues,
}

impl WriteItem {
    /// Bound metadata and secret allocation before any persistence.
    pub fn validate(&self) -> Result<(), Error> {
        if self.operation_id.get_version_num() != 7 {
            return Err(Error::Invalid);
        }
        if self.name.trim().is_empty() || self.name.len() > 200 || self.values.fields.len() > 50 {
            return Err(Error::Invalid);
        }
        if self.values.password.0.len() > 65536
            || self.values.username.0.len() > 65536
            || self.values.notes.0.len() > 65536
            || self
                .values
                .fields
                .iter()
                .any(|field| field.label.len() > 200 || field.value.0.len() > 65536)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

/// Explicit grant within a team vault.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordGrant)]
pub struct Grant {
    /// Item template or grantee category.
    pub kind: GranteeKind,
    /// Identity of this resource within its team.
    pub id: String,
    /// Maximum capability granted to the named recipient.
    pub permission: Permission,
}
/// Future principals can extend this without exposing agent controls in v1.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as=PasswordGranteeKind)]
pub enum GranteeKind {
    /// An existing human member of the vault team.
    User,
    /// All current members of the vault team.
    Team,
}
/// Grant capability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as=PasswordPermission)]
pub enum Permission {
    /// Read metadata and request protected disclosure.
    View,
    /// View and edit the item, without creator or administrator grant management.
    Edit,
}
/// Internal metadata record with authorization facts.
#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    /// Searchable fields only; excludes all private payloads.
    pub metadata: ItemMetadata,
    /// Immutable creator; ownership remains with the team after this person leaves.
    pub user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// Explicit recipients and their item capabilities.
    pub grants: Vec<Grant>,
    /// Deletion fence; prevents reads and delayed-write resurrection.
    pub deleting: bool,
    /// Metadata revision used to preserve later edits during recovery.
    pub revision: i64,
    /// Active generation of the TOTP enrollment; never a seed.
    pub totp_key_id: Option<TotpKeyId>,
}
/// Folder names are metadata only.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordFolder)]
pub struct Folder {
    /// Identity of this resource within its team.
    pub id: Uuid,
    /// Team namespace and authorization boundary.
    pub team_id: TeamId,
    /// Searchable display name; must not contain credential values.
    pub name: String,
    /// Containing folder in the same team; absent for a top-level folder.
    pub parent_id: Option<Uuid>,
}
/// Bounded audit entry, correlated by opaque item/event IDs.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordActivity)]
pub struct Activity {
    /// Identity of this resource within its team.
    pub id: Uuid,
    /// Item associated with this activity.
    pub item_id: ItemId,
    /// Authenticated Macro user identity; never a provider credential.
    pub user_id: String,
    /// Fixed operation category; never derived from secret contents.
    pub action: Action,
    /// Time this activity was recorded.
    pub occurred_at: DateTime<Utc>,
}
/// Only fixed event names enter the audit index.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as=PasswordAction)]
pub enum Action {
    /// Item created.
    Create,
    /// Item metadata or value version updated.
    Update,
    /// Item deletion requested.
    Delete,
    /// Protected value disclosure requested.
    Reveal,
    /// Protected clipboard disclosure requested.
    Copy,
    /// Explicit recipients changed.
    Share,
    /// Verification-code seed enrolled or replaced.
    TotpSetup,
    /// Verification-code seed removed.
    TotpRemove,
    /// Current verification code requested.
    TotpCode,
}
/// Secret response used only by explicit reveal/copy routes.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordRevealed)]
pub struct Revealed {
    /// Private payload; never serialize into the metadata repository.
    pub values: SecretValues,
    /// Committed provider value version.
    pub version: i32,
}
/// Current account identifier, without confidential credentials or custom fields.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordUsername)]
pub struct Username {
    /// Account identifier stored only in the provider and resolved for authorized humans.
    pub username: SecretString,
    /// Committed version used to resolve this identifier.
    pub version: i32,
}
/// Immutable provider version metadata, without historic values.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordVersion)]
pub struct Version {
    /// Committed provider value version.
    pub version: i32,
    /// Resource creation timestamp.
    pub created_at: String,
}
/// Current TOTP output is confidential, just like a password.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as=PasswordTotpCode)]
pub struct TotpCode {
    /// Current confidential verification code.
    pub code: SecretString,
    /// Verification-code period in seconds.
    pub period: u32,
}
/// Sanitized domain failures. Provider messages may contain secrets, so are discarded.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("vault item not found")]
    /// Resource absent or hidden by its authorization boundary.
    NotFound,
    #[error("vault access denied")]
    /// Authenticated caller lacks the required capability.
    Forbidden,
    #[error("invalid vault request")]
    /// Request violates a validated domain invariant.
    Invalid,
    #[error("vault version conflict")]
    /// Observed version or retry operation no longer matches.
    Conflict,
    #[error("folder no longer exists")]
    /// The referenced folder was deleted; the caller must choose another folder.
    FolderMissing,
    #[error("vault is busy; retry the request")]
    /// Lease admission or the team lease is currently held by another operation.
    Busy,
    #[error("vault provider unavailable")]
    /// Provider, metadata storage, or rollout evaluation is unavailable.
    Unavailable,
}

/// A metadata-only change never reads or writes a secret value.
#[derive(Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as=PasswordPatchItem)]
pub struct PatchItem {
    /// Searchable display name; must not contain credential values.
    pub name: String,
    /// Item template or grantee category.
    pub kind: ItemKind,
    /// Optional searchable website URL, without embedded credentials.
    pub url: Option<LoginUrl>,
    /// Optional folder belonging to this same team.
    pub folder_id: Option<Uuid>,
    /// Whether the item is marked as a favorite.
    pub favorite: bool,
    /// Version observed by the editor; absent only for creation.
    pub expected_version: i32,
}

/// A public HTTP(S) login URL; credentials and userinfo are rejected before indexing.
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(try_from = "String", into = "String")]
#[schema(value_type=String,as=PasswordLoginUrl)]
pub struct LoginUrl(String);
impl TryFrom<String> for LoginUrl {
    type Error = Error;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() > 2048 {
            return Err(Error::Invalid);
        }
        let parsed = url::Url::parse(&value).map_err(|_| Error::Invalid)?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(Error::Invalid);
        }
        Ok(Self(value))
    }
}
impl From<LoginUrl> for String {
    fn from(value: LoginUrl) -> Self {
        value.0
    }
}

/// Unique TOTP enrollment generation; replacing a key always creates a new identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TotpKeyId(pub Uuid);
/// A durable retired or uncommitted enrollment ready for delayed erasure.
#[derive(Clone, Copy, Debug)]
pub struct TotpCleanup {
    /// Team namespace containing the enrollment.
    pub team_id: TeamId,
    /// Item whose lifecycle owns this enrollment.
    pub item_id: ItemId,
    /// Unique generation that may be erased after rechecking its retirement.
    pub key_id: TotpKeyId,
}
