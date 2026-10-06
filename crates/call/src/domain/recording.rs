//! Which calls record on their own.
//!
//! Each person chooses which kinds of call their recorder starts for by
//! default, and team admins can block kinds of call for everyone on the team.
//! A call records only when its host records that kind by default and the
//! host's team has not blocked it.

#[cfg(test)]
mod test;

/// The kinds of call the recording rules tell apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallKind {
    /// A call started from a channel.
    Huddle,
    /// A standalone call attended only by the host's teammates.
    InternalMeeting,
    /// A standalone call that someone outside the host's team joined.
    ExternalMeeting,
}

/// One flag per [`CallKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallKinds {
    /// Calls started from a channel.
    pub huddles: bool,
    /// Standalone calls attended only by the host's teammates.
    pub internal_meetings: bool,
    /// Standalone calls that someone outside the host's team joined.
    pub external_meetings: bool,
}

impl CallKinds {
    /// Every kind of call.
    pub const ALL: Self = Self {
        huddles: true,
        internal_meetings: true,
        external_meetings: true,
    };

    /// No kind of call.
    pub const NONE: Self = Self {
        huddles: false,
        internal_meetings: false,
        external_meetings: false,
    };

    /// Whether `kind` is one of these kinds.
    pub fn contains(self, kind: CallKind) -> bool {
        match kind {
            CallKind::Huddle => self.huddles,
            CallKind::InternalMeeting => self.internal_meetings,
            CallKind::ExternalMeeting => self.external_meetings,
        }
    }

    /// These kinds with `patch` applied; kinds the patch omits are unchanged.
    pub fn patched(self, patch: CallKindsPatch) -> Self {
        Self {
            huddles: patch.huddles.unwrap_or(self.huddles),
            internal_meetings: patch.internal_meetings.unwrap_or(self.internal_meetings),
            external_meetings: patch.external_meetings.unwrap_or(self.external_meetings),
        }
    }
}

/// A partial update to [`CallKinds`]. Omitted kinds keep their current value,
/// so two people changing different kinds at once do not undo each other.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallKindsPatch {
    /// New value for calls started from a channel.
    pub huddles: Option<bool>,
    /// New value for standalone calls attended only by teammates.
    pub internal_meetings: Option<bool>,
    /// New value for standalone calls with people from outside the team.
    pub external_meetings: Option<bool>,
}

/// The rules that decide whether a host's calls record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordingRules {
    /// Kinds of call the host records by default.
    pub record_by_default: CallKinds,
    /// Kinds of call the host's team forbids recording.
    pub blocked: CallKinds,
}

impl RecordingRules {
    /// Whether a call of `kind` hosted under these rules records.
    pub fn records(&self, kind: CallKind) -> bool {
        self.record_by_default.contains(kind) && !self.blocked.contains(kind)
    }
}

impl Default for RecordingRules {
    /// Someone who never changed a setting, on a team that blocks nothing:
    /// every call records, as calls did before these settings existed.
    fn default() -> Self {
        Self {
            record_by_default: CallKinds::ALL,
            blocked: CallKinds::NONE,
        }
    }
}

/// The caller's recording settings.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordingSettings {
    /// Kinds of call the caller's own calls record by default.
    pub record_by_default: CallKinds,
    /// The caller's team policy; absent when the caller is not on a team.
    pub team: Option<TeamRecordingPolicy>,
}

/// Kinds of call no one on a team may record.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamRecordingPolicy {
    /// Kinds of call blocked for everyone on the team.
    pub blocked: CallKinds,
    /// Whether the caller may change the blocks (team admins and owners).
    pub can_edit: bool,
}

/// Body of `PATCH /call/settings/recording`.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateRecordingDefaultsRequest {
    /// Changes to the kinds of call the caller records by default.
    pub record_by_default: CallKindsPatch,
}

/// Body of `PATCH /call/settings/recording/team`.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateTeamRecordingPolicyRequest {
    /// Changes to the kinds of call blocked for everyone on the team.
    pub blocked: CallKindsPatch,
}

/// A live call that just gained its first participant from outside the host's
/// team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallTurnedExternal {
    /// The recorder attached to the call at that moment, if any.
    pub egress_id: Option<String>,
}
