use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CallFilters, ast::ExpandErr};

/// the possible literal values in a call filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CallLiteral {
    /// filter by the channel a call belongs to
    ChannelId(Uuid),
}

impl ExpandFrame<CallLiteral> for CallFilters {
    type Err = ExpandErr;

    fn expand_ast(filter_request: CallFilters) -> Result<Option<Expr<CallLiteral>>, Self::Err> {
        let CallFilters { channel_ids } = filter_request;

        let channel_ids = channel_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CallLiteral::ChannelId), Expr::or)?;

        Ok([channel_ids].into_iter().fold_with(Expr::and))
    }
}
