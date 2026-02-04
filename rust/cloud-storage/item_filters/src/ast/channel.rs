use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ChannelFilters, ast::ExpandErr};

/// the possible literal values in a channel filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ChannelLiteral {
    /// the thread id in which we want to find messages
    ThreadId(Uuid),
    /// the message mentions some user x
    Mention(MacroUserIdStr<'static>),
    /// the message is in some organization
    OrganizationId(i64),
    /// the message is in some channel id
    ChannelId(Uuid),
    /// the message comes from some sender x
    Sender(MacroUserIdStr<'static>),
    /// this node value filters by channel importance. false short-circuits to match nothing.
    Importance(bool),
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
            channel_ids,
            sender_ids,
            importance,
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

        let channel_ids = channel_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ChannelLiteral::ChannelId), Expr::or)?;

        let sender_ids = sender_ids
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ChannelLiteral::Sender), Expr::or)?;

        let importance_node = importance.map(|imp| Expr::Literal(ChannelLiteral::Importance(imp)));

        Ok([
            thread_ids,
            mentions,
            organizations,
            channel_ids,
            sender_ids,
            importance_node,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
