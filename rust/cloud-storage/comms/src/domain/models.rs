use item_filters::ast::{LiteralTree, channel::ChannelLiteral};
use macro_user_id::user_id::MacroUserIdStr;
pub use models_comms::*;
use models_pagination::{Query, SimpleSortMethod};
use serde::Deserialize;
use uuid::Uuid;

pub mod channel_name;

pub struct ChannelPreviewsRequest<'a> {
    pub channel_ids: &'a [Uuid],
    pub user: MacroUserIdStr<'a>,
    pub organization_id: Option<channel::OrganizationId>,
}

#[derive(Debug, Deserialize)]
pub struct UserName {
    pub id: MacroUserIdStr<'static>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

impl UserName {
    /// attempt to create the "pretty" name for this user
    /// this can return None if the first name and last name dont exist
    /// or if they are set to "N/A" which is apparrently something that can happen
    pub fn display_name(&self) -> Option<String> {
        const NA: &str = "N/A";
        match (
            self.first_name.as_deref().filter(|v| *v != NA),
            self.last_name.as_deref().filter(|v| *v != NA),
        ) {
            (None, None) => None,
            (None, Some(last)) => Some(last.to_string()),
            (Some(first), None) => Some(first.to_string()),
            (Some(first), Some(last)) => Some(format!("{first} {last}")),
        }
    }
}

#[derive(Debug)]
pub struct GetChannelsRequest {
    pub macro_id: MacroUserIdStr<'static>,
    pub limit: Option<u32>,
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelLiteral>>,
}

impl GetChannelsRequest {
    pub fn into_params(self) -> GetChannelsParams {
        let GetChannelsRequest {
            macro_id,
            limit,
            query,
        } = self;

        // make sure the limit for page size exists within a reasonable range
        let limit = limit.unwrap_or(20).clamp(20, 100);

        GetChannelsParams {
            macro_id,
            limit,
            query,
        }
    }
}

#[expect(dead_code, reason = "This is used in a later PR")]
pub struct GetChannelsParams {
    macro_id: MacroUserIdStr<'static>,
    limit: u32,
    query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelLiteral>>,
}

impl GetChannelsParams {
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.macro_id
    }
}
