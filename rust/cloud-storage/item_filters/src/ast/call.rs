use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CallFilters, CallStatus, ast::ExpandErr};

/// the possible literal values in a call filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CallLiteral {
    /// filter by an individual call record id
    CallId(Uuid),
    /// filter by the channel a call belongs to
    ChannelId(Uuid),
    /// filter by the speaker of a transcript segment
    Speaker(MacroUserIdStr<'static>),
    /// viewer-relative attendance status for the call
    Status(CallStatus),
    /// whether the requesting user attended the call
    Attended(bool),
}

impl ExpandFrame<CallLiteral> for CallFilters {
    type Err = ExpandErr;

    fn expand_ast(filter_request: CallFilters) -> Result<Option<Expr<CallLiteral>>, Self::Err> {
        let CallFilters {
            call_ids,
            channel_ids,
            speaker_ids,
            status,
            attended,
        } = filter_request;

        let call_ids = call_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CallLiteral::CallId), Expr::or)?;

        let channel_ids = channel_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(CallLiteral::ChannelId), Expr::or)?;

        let speaker_ids = speaker_ids
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(CallLiteral::Speaker), Expr::or)?;

        let status = status.map(|status| Expr::Literal(CallLiteral::Status(status)));
        let attended = attended.map(|b| Expr::Literal(CallLiteral::Attended(b)));

        Ok([call_ids, channel_ids, speaker_ids, status, attended]
            .into_iter()
            .fold_with(Expr::and))
    }
}
