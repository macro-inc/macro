//! Persistent meeting links and guest identity validation.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::CallError;

/// A bearer capability that grants access only to a meeting's RTC room.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct MeetingToken(String);

impl MeetingToken {
    /// Generate a capability with 244 random bits, independently of the meeting id.
    pub fn generate() -> Self {
        Self(format!(
            "{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        ))
    }

    /// Read the validated capability for persistence or transport.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for MeetingToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MeetingToken(<redacted>)")
    }
}

impl TryFrom<String> for MeetingToken {
    type Error = CallError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(CallError::NotFound("meeting".to_string()));
        }
        Ok(Self(value))
    }
}

impl From<MeetingToken> for String {
    fn from(value: MeetingToken) -> Self {
        value.0
    }
}

/// Persistent meeting metadata. No channel contents or archived media are exposed.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    /// Persistent meeting identifier.
    pub id: Uuid,
    /// Bearer capability embedded in the invitation URL.
    pub share_token: MeetingToken,
    /// Human-readable meeting title.
    pub title: String,
    /// Scheduled start, or none for an instant meeting.
    pub scheduled_start: Option<DateTime<Utc>>,
    /// Scheduled end, or none for an instant meeting.
    pub scheduled_end: Option<DateTime<Utc>>,
    /// Associated channel, for links to existing channel calls only.
    pub channel_id: Option<Uuid>,
    /// Currently active call session, if any.
    pub call_id: Option<Uuid>,
    /// Creator identity, kept private from public metadata.
    #[serde(skip)]
    pub user_id: String,
    /// Channel call this invitation is pinned to; prevents reuse for later calls.
    #[serde(skip)]
    pub channel_call_id: Option<Uuid>,
}

/// Inputs for creating a meeting without starting its RTC room.
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateMeetingRequest {
    /// Optional display title.
    pub title: Option<String>,
    /// Optional scheduled start.
    pub scheduled_start: Option<DateTime<Utc>>,
    /// Optional scheduled end.
    pub scheduled_end: Option<DateTime<Utc>>,
}

impl CreateMeetingRequest {
    /// Validate time ordering and normalize bounded, nonempty display text.
    pub fn validate(self) -> Result<Self, CallError> {
        let title = self
            .title
            .unwrap_or_else(|| "Macro call".to_string())
            .trim()
            .to_string();
        if title.is_empty() || title.chars().count() > 200 || title.chars().any(char::is_control) {
            return Err(CallError::InvalidRequest(
                "Meeting title must contain 1–200 characters".to_string(),
            ));
        }
        match (self.scheduled_start, self.scheduled_end) {
            (None, None) => {}
            (Some(start), Some(end)) if end > start => {}
            _ => {
                return Err(CallError::InvalidRequest(
                    "Scheduled meetings require an end after their start".to_string(),
                ));
            }
        }
        Ok(Self {
            title: Some(title),
            ..self
        })
    }
}

/// Public guest join inputs. The server generates the participant identity.
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GuestJoinRequest {
    /// Guest's name, displayed to everyone in the room.
    pub display_name: String,
}

impl GuestJoinRequest {
    /// Validate the name before allocating a room or participant.
    pub fn validate(self) -> Result<String, CallError> {
        let name = self.display_name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(CallError::InvalidRequest(
                "Enter a name between 1 and 80 characters".to_string(),
            ));
        }
        Ok(name.to_string())
    }
}

/// A non-account guest of a single call session.
///
/// The id doubles as the guest's RTC participant identity, so identities are
/// opaque UUIDs and never share a namespace (or a column) with Macro user
/// ids. Only the server mints them; Macro users keep `macro|…` identities,
/// so an RTC identity classifies as exactly one of the two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = Uuid))]
#[serde(transparent)]
pub struct GuestId(Uuid);

impl GuestId {
    /// Mint a fresh guest identity for one join.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }

    /// Parse a UUID guest identity; callers must verify its call membership.
    pub fn parse_rtc_identity(identity: &str) -> Option<Self> {
        Uuid::parse_str(identity).ok().map(Self)
    }

    /// Rehydrate a persisted guest id.
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying uuid, for persistence.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for GuestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(test)]
mod test;

/// Uncancelled standalone meetings visible in the requested meeting list.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct MeetingsResponse {
    /// Persistent meeting invitations, most recently created first.
    pub meetings: Vec<Meeting>,
}

/// Active quick-call metadata available to its authenticated owner or attendees.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ActiveMeeting {
    /// Existing meeting metadata, with the same fields as other meeting responses.
    #[serde(flatten)]
    pub meeting: Meeting,
    /// Creator identity for displaying the caller in the authenticated active list.
    pub created_by: String,
}

impl From<Meeting> for ActiveMeeting {
    fn from(meeting: Meeting) -> Self {
        Self {
            created_by: meeting.user_id.clone(),
            meeting,
        }
    }
}

/// The authenticated actor's active quick calls, including their creators.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ActiveMeetingsResponse {
    /// Persistent meeting invitations for currently active sessions.
    pub meetings: Vec<ActiveMeeting>,
}

/// Whether the authenticated caller can invite teammates to this meeting.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct MeetingInvitePermissions {
    /// True for the owner of an uncancelled standalone meeting.
    pub can_invite: bool,
}

/// Registered teammates selected for an incoming call invitation.
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InviteMeetingUsersRequest {
    /// Human user principals; bot principals and historical bare bot UUIDs are invalid.
    #[cfg_attr(feature = "inbound", schema(value_type = Vec<String>))]
    pub user_ids: Vec<MacroUserIdStr<'static>>,
}

impl InviteMeetingUsersRequest {
    /// Bound the batch, omit the caller, and preserve only distinct recipients.
    pub fn recipients(
        self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, CallError> {
        const MAX_MEETING_INVITE_RECIPIENTS: usize = 50;
        if self.user_ids.is_empty() || self.user_ids.len() > MAX_MEETING_INVITE_RECIPIENTS {
            return Err(CallError::InvalidRequest(format!(
                "Choose between 1 and {MAX_MEETING_INVITE_RECIPIENTS} teammates"
            )));
        }
        let mut seen = std::collections::HashSet::new();
        let recipients: Vec<_> = self
            .user_ids
            .into_iter()
            .filter(|user_id| user_id != actor && seen.insert(user_id.clone()))
            .collect();
        if recipients.is_empty() {
            return Err(CallError::InvalidRequest(
                "Choose at least one other teammate".to_string(),
            ));
        }
        Ok(recipients)
    }
}

/// Changes to a meeting's title or scheduled time; omitted values stay unchanged.
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateMeetingRequest {
    /// Replacement title, when supplied.
    pub title: Option<String>,
    /// Replacement scheduled start; requires a matching end.
    pub scheduled_start: Option<DateTime<Utc>>,
    /// Replacement scheduled end; requires a matching start.
    pub scheduled_end: Option<DateTime<Utc>>,
    /// Remove timed scheduling, for example when the calendar event becomes all-day.
    #[serde(default)]
    pub clear_schedule: bool,
}

impl UpdateMeetingRequest {
    /// Apply the same title and time constraints used at creation.
    pub fn validate(self) -> Result<Self, CallError> {
        if self.clear_schedule && (self.scheduled_start.is_some() || self.scheduled_end.is_some()) {
            return Err(CallError::InvalidRequest(
                "Cannot clear a schedule while setting its times".to_string(),
            ));
        }
        let has_title = self.title.is_some();
        let validated = CreateMeetingRequest {
            title: self.title,
            scheduled_start: self.scheduled_start,
            scheduled_end: self.scheduled_end,
        }
        .validate()?;
        Ok(Self {
            clear_schedule: self.clear_schedule,
            title: if has_title { validated.title } else { None },
            scheduled_start: validated.scheduled_start,
            scheduled_end: validated.scheduled_end,
        })
    }
}
