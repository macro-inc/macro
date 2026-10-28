//! Initiative sharing values and task pages.

use async_graphql::{ID, SimpleObject};
use graphql_permission::GraphqlEntityAccessLevel;
use initiative::domain::reads::InitiativeTasksPage;
use models_permissions::share_permission::SharePermissionV2;

use crate::inputs::GraphqlInitiativeLinkShare;

/// Typed sharing state for an initiative.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeSharePermission")]
pub struct GraphqlInitiativeSharePermission {
    /// Stable identifier of the sharing policy.
    id: ID,
    /// Audience permitted through the link, when enabled.
    link_share: Option<GraphqlInitiativeLinkShare>,
    /// Permission granted to the link audience.
    link_share_access_level: Option<GraphqlEntityAccessLevel>,
    /// Explicit permission granted to the owner's team.
    team_share_access_level: Option<GraphqlEntityAccessLevel>,
    /// Owner of the shared initiative.
    owner: String,
    /// Explicit channel sharing grants.
    channel_share_permissions: Vec<GraphqlInitiativeChannelShare>,
}

/// Grant to a shared channel.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeChannelShare")]
pub struct GraphqlInitiativeChannelShare {
    /// Channel receiving access.
    channel_id: ID,
    /// Access granted to the channel.
    access_level: GraphqlEntityAccessLevel,
}

impl From<SharePermissionV2> for GraphqlInitiativeSharePermission {
    fn from(value: SharePermissionV2) -> Self {
        Self {
            id: ID(value.id),
            owner: value.owner,
            link_share: value.link_share.map(Into::into),
            link_share_access_level: value
                .link_share_access_level
                .map(GraphqlEntityAccessLevel::new),
            team_share_access_level: value
                .team_share_access_level
                .map(GraphqlEntityAccessLevel::new),
            channel_share_permissions: value
                .channel_share_permissions
                .unwrap_or_default()
                .into_iter()
                .map(|grant| GraphqlInitiativeChannelShare {
                    channel_id: ID(grant.channel_id),
                    access_level: GraphqlEntityAccessLevel::new(grant.access_level),
                })
                .collect(),
        }
    }
}

/// A page of visible task references.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeTasksPage")]
pub struct GraphqlInitiativeTasksPage {
    /// Visible task identifiers in the current page.
    task_ids: Vec<ID>,
    /// Continuation when another visible page exists.
    next_cursor: Option<String>,
    /// Total tasks visible to this viewer.
    total: u32,
}

impl From<InitiativeTasksPage> for GraphqlInitiativeTasksPage {
    fn from(value: InitiativeTasksPage) -> Self {
        Self {
            task_ids: value.task_ids.into_iter().map(ID).collect(),
            next_cursor: value.next_cursor,
            total: value.total,
        }
    }
}
