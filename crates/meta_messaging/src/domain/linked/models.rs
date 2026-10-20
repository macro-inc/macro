//! Native account/binding models and versioned session-service observations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Independently controlled backend rollout gates. None grants access.
#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedFeatures))]
pub struct Features {
    /// Allow new owner-bound pairing transactions.
    pub pairing: bool,
    /// Allow explicit existing-group adoption.
    pub adoption: bool,
    /// Allow new intentional external operations.
    pub sending: bool,
}
/// One personal account, never owned by a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAccount))]
pub struct Account {
    /// Stable Macro account identity.
    pub id: Uuid,
    /// Authenticated owner.
    pub user_id: String,
    /// Provider-verified identity, absent until pairing finishes.
    pub identity_jid: Option<String>,
    /// Connection health.
    pub state: AccountState,
    /// Explicit consent generation, independent of transport reconnects.
    pub authorization_generation: i64,
    /// Current process incarnation, absent before a worker is assigned.
    pub owner_epoch: Option<i64>,
}
/// Account lifecycle presented by the normal Settings row.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAccountState))]
pub enum AccountState {
    /// Pairing or authenticating.
    Connecting,
    /// Authenticated session ready after metadata reconciliation.
    Connected,
    /// Temporary transport outage; consent survives.
    Offline,
    /// Credentials need explicit owner reconnection.
    Reconnect,
    /// Observation consent has ended.
    Disconnected,
}
/// Durable owner-bound transaction. Challenge/QR material is not retained here.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedPairing))]
pub struct Pairing {
    /// One-use flow ID.
    pub id: Uuid,
    /// Account being connected.
    pub account_id: Uuid,
    /// Initiating human.
    pub user_id: String,
    /// Generation captured at explicit consent.
    pub authorization_generation: i64,
    /// Current transaction state.
    pub state: String,
    /// Database-assigned expiry.
    pub expires_at: DateTime<Utc>,
    /// Terminal transaction time.
    pub consumed_at: Option<DateTime<Utc>>,
    /// Identity a reconnect must preserve.
    pub expected_identity_jid: Option<String>,
}
/// Sensitive owner-only pairing response; deliberately has no Debug implementation.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedPairState))]
pub struct PairState {
    /// Displayed, passkey, confirmation, connected, expired or error.
    pub state: String,
    /// Short-lived QR content; never placed in a URL/cache.
    #[serde(default)]
    pub qr: Option<String>,
    /// Confirmation code shown by the protocol, requiring deliberate confirmation.
    #[serde(default)]
    pub code: Option<String>,
    /// Actual WhatsApp WebAuthn options for the native authenticator only.
    #[serde(default)]
    pub challenge: Option<serde_json::Value>,
    /// Verified linked identity once authenticated.
    #[serde(default)]
    pub identity_jid: Option<String>,
    /// Same owner-bound deadline.
    pub expires_at: DateTime<Utc>,
}
/// Explicit adoption request; account identity is selected server-side.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAdoptGroup))]
pub struct AdoptGroup {
    /// Destination workspace.
    pub team_id: Uuid,
    /// Verified joined remote group.
    pub group_jid: String,
    /// Explicit native audience receiving this binding's shared-history grant.
    pub users: Vec<String>,
}
/// One remote group and native channel in a workspace.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedBinding))]
pub struct Binding {
    /// Stable binding identity, independent of an observing account.
    pub id: Uuid,
    /// Owning workspace.
    pub team_id: Uuid,
    /// Remote group identity, never its display name.
    pub group_jid: String,
    /// Native channel.
    pub channel_id: Uuid,
    /// Designated native content owner.
    pub user_id: String,
    /// Active, suspended or detached.
    pub state: String,
    /// Active or deliberate ownership transfer required.
    pub ownership_state: String,
    /// Default history boundary.
    pub adopted_at: DateTime<Utc>,
}
/// Worker fence supplied on every internal request/event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScope {
    /// Personal account ID.
    pub account_id: Uuid,
    /// Explicit authorization generation.
    pub authorization_generation: i64,
    /// Exclusive process incarnation.
    pub owner_epoch: i64,
}
impl Account {
    /// Require the assigned worker; absence is unavailability, never another sender.
    pub fn scope(&self) -> Result<SessionScope, super::super::models::MessagingError> {
        Ok(SessionScope {
            account_id: self.id,
            authorization_generation: self.authorization_generation,
            owner_epoch: self
                .owner_epoch
                .ok_or(super::super::models::MessagingError::Disconnected)?,
        })
    }
}
/// Verified typed sender aliases, supplied only by protocol metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedIdentity))]
pub struct Identity {
    /// PN or LID account JID.
    pub jid: String,
    /// Verified alternate identity, not inferred from a name or submitted phone.
    #[serde(default)]
    pub alternate_jid: Option<String>,
    /// Untrusted external display name.
    #[serde(default)]
    pub display_name: Option<String>,
}
/// Current remote participant; Macro access remains an independent grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedParticipant))]
pub struct Participant {
    /// Provider identity evidence.
    #[serde(flatten)]
    pub identity: Identity,
    /// Whether remote announcement posting is allowed.
    pub admin: bool,
}
/// Full metadata refresh, rather than incomplete membership deltas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedGroupInfo))]
pub struct GroupInfo {
    /// Typed remote group JID.
    pub jid: String,
    /// Current remote subject.
    pub name: String,
    /// Full remote roster.
    pub participants: Vec<Participant>,
    /// Only admins may post.
    pub announce: bool,
    /// This feature does not retain disappearing content.
    pub disappearing: bool,
    /// Community announcement/parent groups are outside the supported surface.
    pub community: bool,
    /// Monotonic observation version within this worker.
    pub version: i64,
    /// Successful full metadata read time.
    pub observed_at: DateTime<Utc>,
}
impl GroupInfo {
    /// Match only protocol-verified aliases; never names.
    pub fn participant(&self, identity: &str) -> Option<&Participant> {
        self.participants.iter().find(|p| {
            p.identity.jid == identity || p.identity.alternate_jid.as_deref() == Some(identity)
        })
    }
}
/// Canonical quote/mutation reference, never a Macro thread ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// Source message identity.
    pub source_id: String,
    /// Source author account identity.
    pub sender_jid: String,
}
/// Private adapter media reservation; contains no remote URL or key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// Account-private media handle.
    pub id: String,
    /// Validated media category.
    pub kind: String,
    /// Declared type, independently checked after download.
    pub mime: String,
    /// Display filename.
    pub filename: String,
    /// Bounded length.
    pub size: u64,
    /// Expected plaintext content hash.
    pub sha256: String,
}
/// One normalized source message or revision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Provider stanza identity.
    pub source_id: String,
    /// Actual author, not the observer account.
    pub sender: Identity,
    /// Plain text or a safe unsupported-content placeholder.
    pub text: String,
    /// Text, reaction, edit, delete or unsupported.
    pub kind: String,
    /// History is silent for unread/notification effects.
    pub history: bool,
    /// Source revision, independent of ingestion order.
    pub revision: i64,
    /// Source quote or mutation target.
    pub target: Option<Target>,
    /// Supported attachment reservations.
    pub media: Vec<Media>,
}
/// Durable authenticated event. Rust resolves all workspace/channel IDs itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Supported normalized contract version.
    pub schema_version: u16,
    /// Durable journal event identity.
    pub event_id: Uuid,
    /// Account/generation/process fence.
    #[serde(flatten)]
    pub scope: SessionScope,
    /// Group absent only for account-lifecycle events.
    pub group_jid: Option<String>,
    /// Protocol source time.
    pub source_at: DateTime<Utc>,
    /// Observation time.
    pub observed_at: DateTime<Utc>,
    /// Normalized event kind.
    #[serde(rename = "type")]
    pub kind: String,
    /// Source message, without protobuf or keys.
    pub message: Option<Message>,
    /// Full roster fact.
    pub group: Option<GroupInfo>,
    /// Per-participant receipt facts, separate from send acceptance.
    pub receipt: Option<Receipt>,
}

/// Retained transport acceptance; readable independently of current send authority.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportOutcome {
    /// Original immutable command identity.
    pub command_id: Uuid,
    /// Preallocated WhatsApp stanza identity.
    pub source_id: String,
    /// Prepared, dispatching, accepted, unknown or rejected.
    pub state: String,
}

/// One account's authorized publication interval, independent of channel history.
#[derive(Deserialize, Serialize)]
pub struct ObservationGrant {
    /// Explicitly adopted native scope.
    pub binding: Binding,
    /// Later of original adoption and this account's current consent.
    pub starts_at: DateTime<Utc>,
}

/// A receipt by one actual participant, never group-wide delivery/read success.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    /// WhatsApp source message identifiers.
    pub source_ids: Vec<String>,
    /// Verified protocol participant address.
    pub participant_jid: String,
    /// Protocol receipt category, separate from acceptance.
    pub state: String,
}
