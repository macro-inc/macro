//! Bounded predicates for call-only Soup lists.

use std::sync::Arc;

use item_filters::CallStatus;

use super::*;

/// Call partition of the current Soup profile.
pub fn partition() -> Token {
    Token::new("call").expect("static call partition is valid")
}

/// Channel a call belongs to. Standalone calls have no channel fact.
pub fn channel_id() -> Token {
    Token::new("call-channel-id").expect("static call attribute is valid")
}

/// Canonical viewer-relative status of a call.
pub fn status() -> Token {
    Token::new("call-status").expect("static call attribute is valid")
}

/// Compile call-only first pages for authoritative reconciliation.
///
/// The server collects call and channel IDs separately from status conditions.
/// Restrict local reads to literal filters so a mixed Boolean tree cannot be
/// interpreted differently from the server.
pub fn compile_call_list(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
) -> Result<LocalCompileOutcome, CompileError> {
    let unsupported = Ok(LocalCompileOutcome::Unsupported(
        UnsupportedReason::Partition("call"),
    ));
    if request.direction != SortDirection::Desc
        || ast.properties_filter.is_some()
        || !ast.document_filter.as_deref().is_some_and(|expr| {
            proves_none(
                expr,
                |literal| matches!(literal, DocumentLiteral::Id(id) if id.is_nil()),
            )
        })
        || !ast.project_filter.as_deref().is_some_and(|expr| {
            proves_none(
                expr,
                |literal| matches!(literal, ProjectLiteral::ProjectIdSelf(id) | ProjectLiteral::ProjectId(id) if id.is_nil()),
            )
        })
        || !ast.chat_filter.as_deref().is_some_and(|expr| {
            proves_none(
                expr,
                |literal| matches!(literal, ChatLiteral::ChatId(id) if id.is_nil()),
            )
        })
        || !ast.channel_filter.as_deref().is_some_and(|expr| {
            proves_none(
                expr,
                |literal| matches!(literal, ChannelLiteral::ChannelId(id) if id.is_nil()),
            )
        })
        || database_rows_requested(ast.database_row_filter.as_deref())
    {
        return unsupported;
    }

    let predicate = match ast.call_filter.as_deref() {
        None => PredicateExpr::All,
        Some(Expr::Literal(CallLiteral::CallId(id))) if !id.is_nil() => {
            exact_uuid(vocabulary::id(), id)
        }
        Some(Expr::Literal(CallLiteral::ChannelId(id))) => exact_uuid(channel_id(), id),
        Some(Expr::Literal(CallLiteral::Status(value))) => exact_utf8(
            status(),
            match value {
                CallStatus::Attended => "ATTENDED",
                CallStatus::Missed => "MISSED",
                CallStatus::Unattended => "UNATTENDED",
            },
        )?,
        Some(Expr::Literal(CallLiteral::Attended(value))) => {
            let attended = exact_utf8(status(), "ATTENDED")?;
            if *value {
                attended
            } else {
                PredicateExpr::Not(Box::new(attended))
            }
        }
        Some(_) => return unsupported,
    };

    // Let the existing compiler prove all other server partitions are absent.
    let mut base = ast.clone();
    base.call_filter = Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil()))));
    let base = match compile_soup_flat_v4(&base, request)? {
        LocalCompileOutcome::Supported(query) => query,
        unsupported => return Ok(unsupported),
    };
    let mut query = base.as_query().clone();
    query.profile = vocabulary::profile_v6();
    query.partitions = vec![PartitionPredicate {
        partition: partition(),
        predicate,
    }];
    Ok(LocalCompileOutcome::Supported(ValidatedIndexQuery::new(
        query,
    )?))
}
