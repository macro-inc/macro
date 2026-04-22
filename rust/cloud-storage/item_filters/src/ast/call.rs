use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CallFilters, ast::ExpandErr};

/// the possible literal values in a call filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CallLiteral {
    /// filter by the channel a call belongs to
    ChannelId(Uuid),
    /// whether the requesting user attended the call
    Attended(bool),
}

impl ExpandFrame<CallLiteral> for CallFilters {
    type Err = ExpandErr;

    fn expand_ast(filter_request: CallFilters) -> Result<Option<Expr<CallLiteral>>, Self::Err> {
        let CallFilters {
            channel_ids,
            attended,
        } = filter_request;

        let channel_ids = channel_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CallLiteral::ChannelId), Expr::or)?;

        let attended = attended.map(|b| Expr::Literal(CallLiteral::Attended(b)));

        Ok([channel_ids, attended].into_iter().fold_with(Expr::and))
    }
}
