use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

use crate::{
    ChannelFilters,
    ast::{ExpandErr, ParseFromStr, UnknownValue},
};

/// the possible channel types
#[derive(Debug, Serialize, Deserialize, Clone, Copy, Display)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ChannelTypeFilter {
    /// a public channel
    Public,
    /// a private channel
    Private,
    /// a direct message channel
    DirectMessage,
    /// a team channel
    Team,
}

impl ParseFromStr for ChannelTypeFilter {
    fn parse_from_str<T: AsRef<str>>(s: T) -> Result<Self, UnknownValue<Self>> {
        match s.as_ref() {
            "public" => Ok(Self::Public),
            "private" => Ok(Self::Private),
            "direct_message" => Ok(Self::DirectMessage),
            "team" => Ok(Self::Team),
            _ => Err(UnknownValue(
                s.as_ref().to_string(),
                std::marker::PhantomData,
            )),
        }
    }
}

/// the possible literal values in a channel filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ChannelLiteral {
    /// the thread id in which we want to find messages
    ThreadId(Uuid),
    /// the message mentions some user x
    Mention(MacroUserIdStr<'static>),
    /// the message is in some organization
    OrganizationId(i64),
    /// the message is in some team
    TeamId(Uuid),
    /// the message is in some channel id
    ChannelId(Uuid),
    /// the message comes from some sender x
    Sender(MacroUserIdStr<'static>),
    /// the channel type to filter by
    ChannelType(ChannelTypeFilter),
    /// this node value filters by channel importance. false short-circuits to match nothing.
    Importance(bool),
    /// this node value filters by notification done state for channels.
    NotificationDone(bool),
    /// this node value filters by notification seen state for channels.
    NotificationSeen(bool),
}

impl ExpandFrame<ChannelLiteral> for ChannelFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: ChannelFilters,
    ) -> Result<Option<Expr<ChannelLiteral>>, Self::Err> {
        let ChannelFilters {
            thread_ids,
            mentions,
            org_id,
            team_id,
            channel_ids,
            sender_ids,
            channel_types,
            importance,
            notification_filters,
        } = filter_request;

        let thread_ids = thread_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ChannelLiteral::ThreadId), Expr::or)?;

        let mentions = mentions
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ChannelLiteral::Mention), Expr::or)?;

        let organizations = org_id
            .into_iter()
            .expand(ChannelLiteral::OrganizationId, Expr::or);

        let teams = team_id
            .into_iter()
            .map(|s| Uuid::parse_str(&s))
            .try_expand(|r| r.map(ChannelLiteral::TeamId), Expr::or)?;

        let channel_ids = channel_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ChannelLiteral::ChannelId), Expr::or)?;

        let sender_ids = sender_ids
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ChannelLiteral::Sender), Expr::or)?;

        let channel_type_nodes = channel_types
            .iter()
            .map(ChannelTypeFilter::parse_from_str)
            .try_expand(|r| r.map(ChannelLiteral::ChannelType), Expr::or)?;

        let importance_node = importance.map(|imp| Expr::Literal(ChannelLiteral::Importance(imp)));
        let notification_done_node = notification_filters
            .done
            .map(|done| Expr::Literal(ChannelLiteral::NotificationDone(done)));
        let notification_seen_node = notification_filters
            .seen
            .map(|seen| Expr::Literal(ChannelLiteral::NotificationSeen(seen)));

        Ok([
            thread_ids,
            mentions,
            organizations,
            teams,
            channel_ids,
            sender_ids,
            channel_type_nodes,
            importance_node,
            notification_done_node,
            notification_seen_node,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
