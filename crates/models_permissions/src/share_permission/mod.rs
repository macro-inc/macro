use crate::share_permission::access_level::AccessLevel;
use crate::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use model_file_type::FileType;
use serde::{Deserialize, Deserializer};
use utoipa::ToSchema;

pub mod access_level;
pub mod channel_share_permission;
mod link_share;

pub use link_share::LinkShare;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharePermissionV2 {
    /// The share permission id
    pub id: String,
    /// Who can access the item through its share link
    pub link_share: Option<LinkShare>,
    /// The level of access granted through the share link
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_share_access_level: Option<AccessLevel>,
    /// The owner of the item
    pub owner: String,
    /// The channel share permissions for the item
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_share_permissions: Option<Vec<ChannelSharePermission>>,
}

/// The owner's team link-share preference. `Some(scope)` = the team wants new items link-shared
/// at `scope`; `None` = the team wants link sharing off by default.
/// (Wrapped so call sites can't confuse "no team" with "team says off".)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TeamLinkShareDefault(pub Option<LinkShare>);

impl SharePermissionV2 {
    fn new(link_share: Option<LinkShare>, link_share_access_level: Option<AccessLevel>) -> Self {
        SharePermissionV2 {
            id: String::new(),
            link_share,
            link_share_access_level,
            owner: String::new(),
            channel_share_permissions: None,
        }
    }

    /// Resolves the initial link share for a new item: no team → the entity-type default; a team
    /// scope → that scope with the entity's default level (else `View`); a team that turned link
    /// sharing off → off.
    fn resolve(
        team_default: Option<TeamLinkShareDefault>,
        entity_default: (Option<LinkShare>, Option<AccessLevel>),
    ) -> (Option<LinkShare>, Option<AccessLevel>) {
        match team_default {
            None => entity_default,
            Some(TeamLinkShareDefault(Some(scope))) => (
                Some(scope),
                Some(entity_default.1.unwrap_or(AccessLevel::View)),
            ),
            Some(TeamLinkShareDefault(None)) => (None, None),
        }
    }

    /// Creates a new share permission object for a document
    pub fn new_document_share_permission(
        file_type: Option<FileType>,
        team_default: Option<TeamLinkShareDefault>,
    ) -> Self {
        let entity_default = match file_type {
            Some(FileType::Md) => (Some(LinkShare::Public), Some(AccessLevel::Edit)),
            _ => (None, None),
        };

        let (link_share, link_share_access_level) = Self::resolve(team_default, entity_default);
        Self::new(link_share, link_share_access_level)
    }

    /// Creates a new share permission object for an ai chat
    pub fn new_chat_share_permission(team_default: Option<TeamLinkShareDefault>) -> Self {
        let (link_share, link_share_access_level) = Self::resolve(
            team_default,
            (Some(LinkShare::Public), Some(AccessLevel::View)),
        );
        Self::new(link_share, link_share_access_level)
    }

    /// Creates a new share permission object for a project
    pub fn new_project_share_permission(team_default: Option<TeamLinkShareDefault>) -> Self {
        let (link_share, link_share_access_level) = Self::resolve(team_default, (None, None));
        Self::new(link_share, link_share_access_level)
    }
}

/// Deserializes an optional field while preserving explicit `null` values.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSharePermissionRequestV2 {
    /// Who can access the item through its share link. Omit to leave unchanged or pass `null` to
    /// disable link sharing.
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub link_share: Option<Option<LinkShare>>,
    /// The link access level. Omit to leave unchanged or pass `null` to reset it to the default
    /// level when a link share exists.
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub link_share_access_level: Option<Option<AccessLevel>>,
    /// Any channel share permissions to be created/updated/removed
    pub channel_share_permissions: Option<Vec<UpdateChannelSharePermission>>,
}

#[cfg(test)]
mod test;
