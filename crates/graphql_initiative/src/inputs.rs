//! Typed input objects and lossless transport-to-domain conversion.

use async_graphql::{Enum, ID, InputObject, MaybeUndefined};
use chrono::{DateTime, Utc};
use graphql_common::parse_id;
use graphql_permission::GraphqlEntityAccessLevel;
use initiative::domain::{
    models::{CreateInitiativeRequest, UpdateInitiativeRequest},
    reads::{InitiativePageRequest, InitiativeSort, InitiativeTasksRequest},
};
use models_permissions::share_permission::{
    LinkShare, UpdateSharePermissionRequestV2,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};

/// Order for the viewer's initiative collection.
#[derive(Clone, Copy, Default, Enum, Eq, PartialEq)]
#[graphql(name = "InitiativeSort")]
pub enum GraphqlInitiativeSort {
    /// Most recently updated first by default.
    #[default]
    Updated,
    /// Display name, case insensitive.
    Name,
    /// Due date, with unset values last.
    Due,
}

/// Filters and cursor for a project collection page.
#[derive(Default, InputObject)]
pub struct InitiativePageInput {
    /// Page size, one through one hundred.
    pub limit: Option<u16>,
    /// Opaque continuation from the previous page.
    pub cursor: Option<String>,
    /// Case-insensitive name search.
    pub query: Option<String>,
    /// Status option identifier.
    pub status: Option<ID>,
    /// Priority option identifier.
    pub priority: Option<ID>,
    /// Assigned user identifier.
    pub assignee: Option<String>,
    /// Inclusive earliest due date.
    pub due_after: Option<DateTime<Utc>>,
    /// Inclusive latest due date.
    pub due_before: Option<DateTime<Utc>>,
    /// Ordering, defaulting to updated time.
    #[graphql(default)]
    pub sort: GraphqlInitiativeSort,
    /// Reverse the chosen order.
    pub descending: Option<bool>,
}

impl InitiativePageInput {
    pub(crate) fn into_model(self) -> async_graphql::Result<InitiativePageRequest> {
        Ok(InitiativePageRequest {
            limit: self.limit,
            cursor: self.cursor,
            query: self.query,
            status: self
                .status
                .map(|value| parse_id(value, "status"))
                .transpose()?,
            priority: self
                .priority
                .map(|value| parse_id(value, "priority"))
                .transpose()?,
            assignee: self.assignee,
            due_after: self.due_after,
            due_before: self.due_before,
            sort: match self.sort {
                GraphqlInitiativeSort::Updated => InitiativeSort::Updated,
                GraphqlInitiativeSort::Name => InitiativeSort::Name,
                GraphqlInitiativeSort::Due => InitiativeSort::Due,
            },
            descending: self.descending,
        })
    }
}

/// Cursor pagination for visible initiative tasks.
#[derive(Default, InputObject)]
pub struct InitiativeTasksInput {
    /// Page size, one through one hundred.
    pub limit: Option<u16>,
    /// Opaque continuation from the previous page.
    pub cursor: Option<String>,
}

impl From<InitiativeTasksInput> for InitiativeTasksRequest {
    fn from(value: InitiativeTasksInput) -> Self {
        Self {
            limit: value.limit,
            cursor: value.cursor,
        }
    }
}

/// Create an initiative owned by the authenticated viewer.
#[derive(InputObject)]
pub struct CreateInitiativeInput {
    /// Initial name.
    pub name: String,
    /// Initial description Markdown.
    pub description: Option<String>,
    /// Initial collaborators.
    pub member_ids: Option<Vec<String>>,
    /// Whether to share with the owner's team, defaulting to true.
    pub share_with_team: Option<bool>,
}

impl From<CreateInitiativeInput> for CreateInitiativeRequest {
    fn from(value: CreateInitiativeInput) -> Self {
        Self {
            name: value.name,
            description: value.description,
            member_ids: value.member_ids,
            share_with_team: value.share_with_team,
        }
    }
}

/// Link recipients supported by the sharing domain.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
#[graphql(name = "InitiativeLinkShare")]
pub enum GraphqlInitiativeLinkShare {
    /// Everyone with the link.
    Public,
    /// Members of the owner's team with the link.
    Team,
}

impl From<LinkShare> for GraphqlInitiativeLinkShare {
    fn from(value: LinkShare) -> Self {
        match value {
            LinkShare::Public => Self::Public,
            LinkShare::Team => Self::Team,
        }
    }
}

impl From<GraphqlInitiativeLinkShare> for LinkShare {
    fn from(value: GraphqlInitiativeLinkShare) -> Self {
        match value {
            GraphqlInitiativeLinkShare::Public => Self::Public,
            GraphqlInitiativeLinkShare::Team => Self::Team,
        }
    }
}

/// Mutation of one channel grant.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
#[graphql(name = "InitiativeChannelShareOperation")]
pub enum GraphqlInitiativeChannelShareOperation {
    /// Add a grant.
    Add,
    /// Remove a grant.
    Remove,
    /// Replace a grant.
    Replace,
}

/// A channel sharing patch.
#[derive(InputObject)]
pub struct InitiativeChannelShareInput {
    /// Kind of channel grant change.
    pub operation: GraphqlInitiativeChannelShareOperation,
    /// Channel identifier.
    pub channel_id: ID,
    /// Grant level for add or replace.
    pub access_level: Option<GraphqlEntityAccessLevel>,
}

/// Sharing patch; omitted and null fields have distinct meanings.
#[derive(InputObject)]
pub struct InitiativeSharePermissionInput {
    /// Omit to preserve, null to disable link sharing.
    pub link_share: MaybeUndefined<GraphqlInitiativeLinkShare>,
    /// Omit to preserve, null to reset to the domain default.
    pub link_share_access_level: MaybeUndefined<GraphqlEntityAccessLevel>,
    /// Omit to preserve, null to disable team sharing.
    pub team_share_access_level: MaybeUndefined<GraphqlEntityAccessLevel>,
    /// Changes to channel grants.
    pub channel_share_permissions: Option<Vec<InitiativeChannelShareInput>>,
}

impl From<InitiativeSharePermissionInput> for UpdateSharePermissionRequestV2 {
    fn from(value: InitiativeSharePermissionInput) -> Self {
        Self {
            link_share: patch(value.link_share, LinkShare::from),
            link_share_access_level: patch(
                value.link_share_access_level,
                GraphqlEntityAccessLevel::into_model,
            ),
            team_share_access_level: patch(
                value.team_share_access_level,
                GraphqlEntityAccessLevel::into_model,
            ),
            channel_share_permissions: value.channel_share_permissions.map(|items| {
                items
                    .into_iter()
                    .map(|item| UpdateChannelSharePermission {
                        operation: match item.operation {
                            GraphqlInitiativeChannelShareOperation::Add => UpdateOperation::Add,
                            GraphqlInitiativeChannelShareOperation::Remove => {
                                UpdateOperation::Remove
                            }
                            GraphqlInitiativeChannelShareOperation::Replace => {
                                UpdateOperation::Replace
                            }
                        },
                        channel_id: item.channel_id.to_string(),
                        access_level: item.access_level.map(GraphqlEntityAccessLevel::into_model),
                    })
                    .collect()
            }),
        }
    }
}

/// Keep absent, cleared, and replaced share fields distinct through the domain boundary.
fn patch<T, U>(value: MaybeUndefined<T>, convert: impl FnOnce(T) -> U) -> Option<Option<U>> {
    match value {
        MaybeUndefined::Undefined => None,
        MaybeUndefined::Null => Some(None),
        MaybeUndefined::Value(value) => Some(Some(convert(value))),
    }
}

/// Partial initiative update; collaborator lists replace the previous list.
#[derive(InputObject)]
pub struct UpdateInitiativeInput {
    /// Replacement name.
    pub name: Option<String>,
    /// Full replacement collaborator list, authorized by the domain service.
    pub member_ids: Option<Vec<String>>,
    /// Sharing patch, authorized by the domain service.
    pub share_permission: Option<InitiativeSharePermissionInput>,
}

impl From<UpdateInitiativeInput> for UpdateInitiativeRequest {
    fn from(value: UpdateInitiativeInput) -> Self {
        Self {
            name: value.name,
            member_ids: value.member_ids,
            share_permission: value.share_permission.map(Into::into),
        }
    }
}
