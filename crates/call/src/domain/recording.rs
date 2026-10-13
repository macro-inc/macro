//! Which calls record on their own.
//!
//! Each person chooses which kinds of call their recorder starts for by
//! default, and who each kind is shared with once it ends; team admins can
//! block recording kinds of call, or sharing huddles with the team, for
//! everyone on the team.
//! A call records only when its host records that kind by default and the
//! host's team has not blocked it.
//!
//! Anyone can also refuse to be recorded or transcribed in one-on-ones. That
//! overrides the host, but only while the call stays a one-on-one.
//!
//! A standalone call can change kind while it is live. Its recording stops
//! the first time it becomes a kind its host does not record, and starts the
//! first time it becomes one they do; a call never starts a second recording,
//! so a stopped recording is not resumed.

#[cfg(test)]
mod test;

/// The kinds of call the recording rules tell apart.
///
/// A standalone call grows through the meeting kinds in order: it is a
/// one-on-one until a third person joins, then an internal meeting, and an
/// external meeting once someone from outside the host's team joins (which can
/// happen at any point, and ends the progression).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallKind {
    /// A call started from a channel other than a two-person direct message.
    Huddle,
    /// A huddle in a two-person direct message, or a standalone call that at
    /// most two people, all on the host's team, have joined so far.
    OneOnOne,
    /// A standalone call that three or more of the host's teammates joined.
    InternalMeeting,
    /// A standalone call that someone outside the host's team joined.
    ExternalMeeting,
}

/// One flag per [`CallKind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallKinds {
    /// Calls started from a channel other than a two-person direct message.
    pub huddles: bool,
    /// Huddles in a two-person direct message, and standalone calls with only
    /// two people, both teammates.
    pub one_on_ones: bool,
    /// Standalone calls with three or more people, all teammates.
    pub internal_meetings: bool,
    /// Standalone calls that someone outside the host's team joined.
    pub external_meetings: bool,
}

impl CallKinds {
    /// Every kind of call.
    pub const ALL: Self = Self {
        huddles: true,
        one_on_ones: true,
        internal_meetings: true,
        external_meetings: true,
    };

    /// No kind of call.
    pub const NONE: Self = Self {
        huddles: false,
        one_on_ones: false,
        internal_meetings: false,
        external_meetings: false,
    };

    /// Whether `kind` is one of these kinds.
    pub fn contains(self, kind: CallKind) -> bool {
        match kind {
            CallKind::Huddle => self.huddles,
            CallKind::OneOnOne => self.one_on_ones,
            CallKind::InternalMeeting => self.internal_meetings,
            CallKind::ExternalMeeting => self.external_meetings,
        }
    }

    /// These kinds with `patch` applied; kinds the patch omits are unchanged.
    pub fn patched(self, patch: CallKindsPatch) -> Self {
        Self {
            huddles: patch.huddles.unwrap_or(self.huddles),
            one_on_ones: patch.one_on_ones.unwrap_or(self.one_on_ones),
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
    /// New value for huddles.
    pub huddles: Option<bool>,
    /// New value for one-on-ones.
    pub one_on_ones: Option<bool>,
    /// New value for standalone calls with three or more people, all teammates.
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

/// Who can open a call's recording, transcript and notes once it ends, besides
/// its host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum ShareAudience {
    /// Only the people who joined it.
    Participants,
    /// Everyone in the channel it was started from.
    Channel,
    /// Everyone invited to it, whether or not they joined.
    Invited,
    /// Everyone on its host's team.
    Team,
}

impl ShareAudience {
    /// The name the database stores.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Participants => "participants",
            Self::Channel => "channel",
            Self::Invited => "invited",
            Self::Team => "team",
        }
    }

    /// The audience the database stores as `name`.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "participants" => Some(Self::Participants),
            "channel" => Some(Self::Channel),
            "invited" => Some(Self::Invited),
            "team" => Some(Self::Team),
            _ => None,
        }
    }
}

impl CallKind {
    /// Whether calls of this kind can be shared with `audience`. Huddles
    /// always reach their channel, and a one-on-one has no one else to invite.
    pub fn allows(self, audience: ShareAudience) -> bool {
        use ShareAudience::*;
        match self {
            Self::Huddle => matches!(audience, Channel | Team),
            Self::OneOnOne => matches!(audience, Participants | Team),
            Self::InternalMeeting | Self::ExternalMeeting => {
                matches!(audience, Participants | Invited | Team)
            }
        }
    }
}

/// Who each kind of call a person hosts is shared with once it ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ShareByDefault {
    /// Huddles: their channel or the whole team.
    pub huddles: ShareAudience,
    /// One-on-ones: the two people in them or the whole team.
    pub one_on_ones: ShareAudience,
    /// Internal meetings: participants, invitees or the whole team.
    pub internal_meetings: ShareAudience,
    /// External meetings: participants, invitees or the whole team.
    pub external_meetings: ShareAudience,
}

impl ShareByDefault {
    /// The audience of a call of `kind`.
    pub fn audience(self, kind: CallKind) -> ShareAudience {
        match kind {
            CallKind::Huddle => self.huddles,
            CallKind::OneOnOne => self.one_on_ones,
            CallKind::InternalMeeting => self.internal_meetings,
            CallKind::ExternalMeeting => self.external_meetings,
        }
    }

    /// These audiences with `patch` applied, or the first kind the patch
    /// gives an audience it cannot have.
    pub fn patched(self, patch: ShareByDefaultPatch) -> Result<Self, CallKind> {
        let pick = |kind: CallKind, current: ShareAudience, new: Option<ShareAudience>| match new {
            Some(audience) if !kind.allows(audience) => Err(kind),
            new => Ok(new.unwrap_or(current)),
        };
        Ok(Self {
            huddles: pick(CallKind::Huddle, self.huddles, patch.huddles)?,
            one_on_ones: pick(CallKind::OneOnOne, self.one_on_ones, patch.one_on_ones)?,
            internal_meetings: pick(
                CallKind::InternalMeeting,
                self.internal_meetings,
                patch.internal_meetings,
            )?,
            external_meetings: pick(
                CallKind::ExternalMeeting,
                self.external_meetings,
                patch.external_meetings,
            )?,
        })
    }
}

impl Default for ShareByDefault {
    /// Someone who never changed a setting: huddles reach their channel,
    /// one-on-ones stay between the two people, internal meetings reach
    /// everyone invited and external meetings the whole team.
    fn default() -> Self {
        Self {
            huddles: ShareAudience::Channel,
            one_on_ones: ShareAudience::Participants,
            internal_meetings: ShareAudience::Invited,
            external_meetings: ShareAudience::Team,
        }
    }
}

/// A partial update to [`ShareByDefault`]. Omitted kinds keep their audience.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ShareByDefaultPatch {
    /// New audience for huddles: `channel` or `team`.
    pub huddles: Option<ShareAudience>,
    /// New audience for one-on-ones: `participants` or `team`.
    pub one_on_ones: Option<ShareAudience>,
    /// New audience for internal meetings: `participants`, `invited` or `team`.
    pub internal_meetings: Option<ShareAudience>,
    /// New audience for external meetings: `participants`, `invited` or `team`.
    pub external_meetings: Option<ShareAudience>,
}

/// Everything a person's call settings decide, with their team's blocks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CallPreferences {
    /// Whether the calls they host record.
    pub recording: RecordingRules,
    /// Who the calls they host are shared with.
    pub share_by_default: ShareByDefault,
    /// Their team forbids sharing the calls they start from a channel with it.
    pub huddle_sharing_blocked: bool,
    /// They do not allow being recorded or transcribed in one-on-ones.
    pub refuses_one_on_one_recording: bool,
}

impl CallPreferences {
    /// Whether a huddle of `kind` (a [`CallKind::Huddle`] or a direct-message
    /// [`CallKind::OneOnOne`]) they host starts shared with their team.
    pub fn shares_huddle_with_team(&self, kind: CallKind) -> bool {
        self.share_by_default.audience(kind) == ShareAudience::Team && !self.huddle_sharing_blocked
    }
}

/// The caller's call settings.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallSettings {
    /// Kinds of call the caller's own calls record by default.
    pub record_by_default: CallKinds,
    /// Who each kind of call the caller hosts is shared with once it ends.
    pub share_by_default: ShareByDefault,
    /// The caller does not allow being recorded or transcribed in
    /// one-on-ones, whoever hosts them.
    pub refuse_one_on_one_recording: bool,
    /// The caller's team policy; absent when the caller is not on a team.
    pub team: Option<TeamCallPolicy>,
}

/// What a team's admins forbid for everyone on the team.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamCallPolicy {
    /// Kinds of call no one on the team may record.
    pub recording_blocked: CallKinds,
    /// No call started from a channel, direct messages included, may be
    /// shared with the team.
    pub huddle_sharing_blocked: bool,
    /// Whether the caller may change the blocks (team admins and owners).
    pub can_edit: bool,
}

/// Body of `PATCH /call/settings`. Omitted fields keep their current value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateCallSettingsRequest {
    /// Changes to the kinds of call the caller records by default.
    #[serde(default)]
    pub record_by_default: CallKindsPatch,
    /// Changes to who each kind of call the caller hosts is shared with.
    #[serde(default)]
    pub share_by_default: ShareByDefaultPatch,
    /// New value for refusing to be recorded or transcribed in one-on-ones.
    pub refuse_one_on_one_recording: Option<bool>,
}

/// Body of `PATCH /call/settings/team`. Omitted fields keep their current
/// value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct UpdateTeamCallPolicyRequest {
    /// Changes to the kinds of call no one on the team may record.
    #[serde(default)]
    pub recording_blocked: CallKindsPatch,
    /// New value for forbidding sharing huddles with the team.
    pub huddle_sharing_blocked: Option<bool>,
}

/// A live standalone call that just became a later [`CallKind`]: its third
/// participant or its first from outside the host's team joined.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeetingKindChange {
    /// The recorder attached to the call at that moment, if any.
    pub egress_id: Option<String>,
}

/// Who a live standalone call has had so far. Both flags only ever turn on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MeetingAttendance {
    /// A third person joined while everyone was on the host's team.
    pub more_than_two: bool,
    /// Someone from outside the host's team joined.
    pub external: bool,
}

impl MeetingAttendance {
    /// The kinds of call the session has been since it was `since`, oldest
    /// first, ending with its current kind.
    pub fn kinds_since(self, since: CallKind) -> Vec<CallKind> {
        let mut kinds = vec![since];
        // A call only gains its third participant while still internal, so a
        // call that is both went through the internal kind first.
        if since == CallKind::OneOnOne && self.more_than_two {
            kinds.push(CallKind::InternalMeeting);
        }
        if matches!(since, CallKind::OneOnOne | CallKind::InternalMeeting) && self.external {
            kinds.push(CallKind::ExternalMeeting);
        }
        kinds
    }
}
