//! Domain models for channel labels.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Longest accepted label name, in characters.
pub const MAX_LABEL_NAME_LEN: usize = 80;

/// Longest accepted substring for name matching.
pub const MAX_SMART_TAG_PATTERN_LEN: usize = 200;

/// An attribute rule that automatically groups matching channels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "attribute", rename_all = "snake_case")]
pub enum ChannelLabelRule {
    /// Case-insensitive, literal substring matching on the channel name.
    Name {
        /// The substring to find anywhere in the name.
        contains: String,
    },
}

impl ChannelLabelRule {
    /// Substring for the currently supported name attribute.
    pub fn name_contains(&self) -> &str {
        match self {
            Self::Name { contains } => contains,
        }
    }
}

/// A channel visible to the caller that matches a smart tag rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct SmartTagChannelMatch {
    /// Channel id.
    pub id: Uuid,
    /// Channel display name.
    pub name: String,
}

/// A bounded preview and the total number of visible channels matching a rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SmartTagPreview {
    /// First matches, in alphabetical order.
    pub channels: Vec<SmartTagChannelMatch>,
    /// Number of matching channels the caller participates in, including overflow.
    pub total_count: i64,
}

/// A shared or account-private label grouping chat channels in the sidebar.
///
/// `channel_ids` is viewer-relative: it lists only the labelled channels the
/// requesting user participates in. `channel_count` counts every channel in
/// the label so clients can warn accurately before a delete.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChannelLabel {
    /// Stable label id.
    pub id: Uuid,
    /// Owning team, or `None` for account-private labels.
    pub team_id: Option<Uuid>,
    /// Display name, unique within the scope (case-insensitive).
    pub name: String,
    /// Automatic membership rule, or `None` for a manually managed label.
    pub rule: Option<ChannelLabelRule>,
    /// Manual ordering value within the scope; lower sorts first.
    pub sort_order: f64,
    /// Channels in this label that the requesting user participates in.
    pub channel_ids: Vec<Uuid>,
    /// All assignments for a manual label; visible matches for a smart tag.
    pub channel_count: i64,
    /// When the label was created.
    pub created_at: DateTime<Utc>,
    /// When the label was last renamed or reordered.
    pub updated_at: DateTime<Utc>,
}

/// The authorized scope's labels in manual order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChannelLabelsList {
    /// Team scope, or `None` for private labels.
    pub team_id: Option<Uuid>,
    /// Every label of the scope, whether or not the caller sees channels in it.
    pub labels: Vec<ChannelLabel>,
}

/// A label to create, with the channels to put in it right away.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewChannelLabel {
    /// Display name.
    pub name: String,
    /// Automatic membership rule; smart tags cannot have manual assignments.
    pub rule: Option<ChannelLabelRule>,
    /// Channels to move into the new label.
    pub channel_ids: Vec<Uuid>,
}

/// Result of persisting a new or renamed label.
#[derive(Debug, Clone, PartialEq)]
pub enum LabelWriteOutcome {
    /// The label as stored.
    Written(ChannelLabel),
    /// Another label of the scope already has this name.
    NameTaken,
    /// The label to rename does not exist in the scope.
    NotFound,
    /// A requested channel is missing, inaccessible, or ineligible for this scope.
    InvalidChannel(SetChannelLabelOutcome),
}

/// Result of changing which label a channel belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetChannelLabelOutcome {
    /// The channel now carries the requested label (or none).
    Updated,
    /// No such channel, or the actor may not see it.
    ChannelNotFound,
    /// The target label does not exist in the scope.
    LabelNotFound,
    /// Only team channels belonging to the label's scope can be labelled.
    ChannelNotLabelable,
    /// Smart tag membership is determined by its rule, not manual assignments.
    SmartTagReadOnly,
}

/// Namespace in which channel labels and assignments are isolated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelLabelsScope {
    /// Labels shared by a verified team member.
    Team(Uuid),
    /// Labels private to the authenticated account.
    User(MacroUserIdStr<'static>),
}

impl ChannelLabelsScope {
    /// Whether a channel's owning team permits grouping it in this namespace.
    /// Non-team channels have no owning team and cannot be labelled. Shared
    /// labels accept only their own team's channels; private labels accept any
    /// team channel the viewer participates in.
    pub fn can_label_channel(&self, channel_team_id: Option<Uuid>) -> bool {
        match (self, channel_team_id) {
            (Self::Team(team_id), Some(channel_team_id)) => *team_id == channel_team_id,
            (Self::User(_), Some(_)) => true,
            (_, None) => false,
        }
    }

    /// Stable persistence key for this namespace.
    pub fn key(&self) -> String {
        match self {
            Self::Team(id) => format!("team:{id}"),
            Self::User(id) => format!("user:{id}"),
        }
    }

    /// Team owning this namespace, if shared.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            Self::Team(id) => Some(*id),
            Self::User(_) => None,
        }
    }

    /// Account owning this namespace, if private.
    pub fn owner_id(&self) -> Option<&str> {
        match self {
            Self::Team(_) => None,
            Self::User(id) => Some(id.as_ref()),
        }
    }
}

/// Authorized label namespace and the authenticated viewer.
#[derive(Debug)]
pub struct ChannelLabelsReceipt {
    scope: ChannelLabelsScope,
    user_id: MacroUserIdStr<'static>,
}

impl ChannelLabelsReceipt {
    /// Resolve shared labels from a verified team receipt, otherwise private
    /// labels from the authenticated identity. The receipt must belong to that identity.
    pub fn from_access(
        user_id: MacroUserIdStr<'static>,
        receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<Self, ChannelLabelsError> {
        let scope = match receipt {
            Some(receipt) => {
                if receipt.entity().entity_type != EntityType::Team
                    || receipt
                        .get_authenticated_user()
                        .map_err(|_| ChannelLabelsError::Unauthorized)?
                        != &user_id
                {
                    return Err(ChannelLabelsError::Unauthorized);
                }
                let team_id = Uuid::parse_str(&receipt.entity().entity_id)
                    .map_err(|_| ChannelLabelsError::Unauthorized)?;
                ChannelLabelsScope::Team(team_id)
            }
            None => ChannelLabelsScope::User(user_id.clone()),
        };
        Ok(Self { scope, user_id })
    }

    /// Authorized namespace for this call.
    pub fn scope(&self) -> &ChannelLabelsScope {
        &self.scope
    }

    /// Authenticated viewer making the call.
    pub fn user_id(&self) -> &MacroUserIdStr<'static> {
        &self.user_id
    }

    /// Test-only team receipt without an access check.
    #[cfg(test)]
    pub(crate) fn dangerously_internal(team_id: Uuid, user_id: &str) -> Self {
        Self {
            scope: ChannelLabelsScope::Team(team_id),
            user_id: MacroUserIdStr::try_from(user_id.to_owned()).expect("valid user id"),
        }
    }
}

/// Errors returned by the channel labels service.
#[derive(Debug, thiserror::Error)]
pub enum ChannelLabelsError {
    /// The label or channel could not be found in the scope.
    #[error("{0}")]
    NotFound(&'static str),
    /// Another label of the scope already uses this name.
    #[error("a label named \"{0}\" already exists")]
    NameTaken(String),
    /// The request was invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The caller is not an authenticated member of the scope.
    #[error("you do not have access to these labels")]
    Unauthorized,
    /// Any other internal error.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
