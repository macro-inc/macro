//! Structured content of WhatsApp messages that are more than text: polls,
//! locations, contact cards, events and system lines. Stored as JSON on the
//! group message (`whatsapp_group_message.rich`) in this form; the timeline
//! resolves the WhatsApp ids in it to names when it is read.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// What a message carries besides its text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RichContent {
    /// A poll; votes are stored per voter and tallied when read.
    Poll(Poll),
    /// A vote on a poll (the message's target): the options chosen now.
    /// Never stored on a message.
    PollVote(PollVote),
    /// A place, or a live location as of when it was shared.
    Location(Location),
    /// One or more contact cards.
    Contacts(Contacts),
    /// A WhatsApp event (calendar invite).
    Event(Event),
    /// Something that happened in the group rather than something said.
    System(SystemLine),
}

/// A poll as created.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Poll {
    /// The question.
    pub question: String,
    /// The options, in order.
    pub options: Vec<PollOption>,
    /// How many options one voter may choose; 0 means any number.
    pub selectable_count: u32,
}

/// One option of a poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollOption {
    /// Its text.
    pub name: String,
    /// SHA-256 of the text, hex: how votes name it.
    pub hash: String,
}

/// A voter's current choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollVote {
    /// Hashes (hex) of the options chosen; empty withdraws the vote.
    pub selected: Vec<String>,
}

/// A shared place.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppLocation))]
pub struct Location {
    /// Degrees.
    pub latitude: f64,
    /// Degrees.
    pub longitude: f64,
    /// Place name.
    #[serde(default)]
    pub name: Option<String>,
    /// Street address.
    #[serde(default)]
    pub address: Option<String>,
    /// Link the sender attached.
    #[serde(default)]
    pub url: Option<String>,
    /// Shared as a live location (this is where it started).
    #[serde(default)]
    pub live: bool,
    /// Caption or comment.
    #[serde(default)]
    pub comment: Option<String>,
}

/// Contact cards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppContacts))]
pub struct Contacts {
    /// The cards, in order.
    pub contacts: Vec<ContactCard>,
}

/// One contact card, from its vCard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppContactCard))]
pub struct ContactCard {
    /// Display name.
    pub name: String,
    /// Phone numbers as written on the card.
    pub phones: Vec<String>,
}

/// A WhatsApp event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppEvent))]
pub struct Event {
    /// Title.
    pub name: String,
    /// Description.
    #[serde(default)]
    pub description: Option<String>,
    /// Start.
    #[serde(default)]
    pub start_at: Option<DateTime<Utc>>,
    /// End.
    #[serde(default)]
    pub end_at: Option<DateTime<Utc>>,
    /// Place name or address.
    #[serde(default)]
    pub location: Option<String>,
    /// Call link for an online event.
    #[serde(default)]
    pub join_link: Option<String>,
    /// Canceled by its organizer.
    #[serde(default)]
    pub canceled: bool,
}

/// Something that happened in the group. The message's sender is who did it,
/// unless WhatsApp did not say (then the sender is the group itself).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemLine {
    /// What happened.
    pub action: SystemAction,
    /// The people it happened to (added, removed, promoted…), as WhatsApp ids.
    #[serde(default)]
    pub participants: Vec<String>,
    /// The new subject or description, or the disappearing-messages timer in
    /// seconds ("0" is off).
    #[serde(default)]
    pub value: Option<String>,
    /// For calls: what kind and how it went.
    #[serde(default)]
    pub call: Option<Call>,
    /// WhatsApp did not say who did it; the message's sender is the group.
    #[serde(default)]
    pub by_whatsapp: bool,
}

/// Kinds of system lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppSystemAction))]
pub enum SystemAction {
    /// The group was created.
    GroupCreated,
    /// The sender added `participants`.
    ParticipantsAdded,
    /// The sender removed `participants`.
    ParticipantsRemoved,
    /// `participants` left.
    ParticipantsLeft,
    /// `participants` joined with an invite link.
    ParticipantsJoined,
    /// The sender made `participants` admins.
    ParticipantsPromoted,
    /// The sender removed `participants` as admins.
    ParticipantsDemoted,
    /// The sender changed the subject to `value`.
    SubjectChanged,
    /// The sender changed the group icon.
    IconChanged,
    /// The sender changed the description to `value` (absent: removed it).
    DescriptionChanged,
    /// The sender set disappearing messages to `value` seconds ("0": off).
    DisappearingChanged,
    /// The sender pinned the message the line replies to.
    MessagePinned,
    /// The sender unpinned the message the line replies to.
    MessageUnpinned,
    /// A call in the group (`call` says which).
    Call,
}

/// A call in the group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppCall))]
pub struct Call {
    /// Video rather than voice.
    pub video: bool,
    /// How it went for the account that saw it.
    pub outcome: CallOutcome,
    /// Length, when it connected.
    #[serde(default)]
    pub duration_seconds: Option<u32>,
}

/// How a call went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppCallOutcome))]
pub enum CallOutcome {
    /// Answered.
    Answered,
    /// Not answered.
    Missed,
    /// Declined.
    Rejected,
    /// Failed or still going when reported.
    Other,
}
