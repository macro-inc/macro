use super::*;
use filter_ast::Expr;
use item_filters::ast::{
    agent_session::AgentSessionLiteral, calendar_event::CalendarEventLiteral, chat::ChatLiteral,
    document::DocumentLiteral, project::ProjectLiteral,
};
use models_pagination::{CursorVal, CursorWithValAndFilter, Query, SimpleSortMethod};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

/// Every statement on a closed pool fails, so an `Ok` page ran none.
async fn closed_repo() -> PgSoupRepo {
    let pool = PgPool::connect_lazy("postgres://soup@localhost/closed").unwrap();
    pool.close().await;
    PgSoupRepo::new(ReadOnlyPool(pool))
}

fn nil<T>(literal: impl Fn(Uuid) -> T) -> Option<Arc<Expr<T>>> {
    Some(Arc::new(Expr::val(literal(Uuid::nil()))))
}

/// The CRM record tabs' base filter: every main-leg source pinned to the nil
/// id, with agent sessions pinned the way Home pins them. `project` is the
/// parent pin those tabs send, or the self pin GraphQL and Tasks send.
fn pinned_to_nothing(project: fn(Uuid) -> ProjectLiteral) -> EntityFilterAst {
    EntityFilterAst {
        calendar_event_filter: nil(CalendarEventLiteral::Id),
        document_filter: nil(DocumentLiteral::Id),
        chat_filter: nil(ChatLiteral::ChatId),
        project_filter: nil(project),
        agent_session_filter: nil(AgentSessionLiteral::Id),
        ..EntityFilterAst::default()
    }
}

fn request(filter: EntityFilterAst, follow_up: bool) -> SimpleSortRequest<'static> {
    let query = if follow_up {
        Query::Cursor(CursorWithValAndFilter {
            id: Uuid::from_u128(1),
            limit: 50,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap(),
            },
            filter,
        })
    } else {
        Query::Sort(SimpleSortMethod::UpdatedAt, filter)
    };
    SimpleSortRequest {
        limit: 50,
        cursor: SimpleSortQuery::ItemsFilter(query),
        user_id: MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap(),
    }
}

#[tokio::test]
async fn sources_pinned_to_nothing_run_no_statement() {
    let repo = closed_repo().await;
    for project in [ProjectLiteral::ProjectId, ProjectLiteral::ProjectIdSelf] {
        for follow_up in [false, true] {
            let page = repo
                .expanded_generic_cursor_soup_with_projection(request(
                    pinned_to_nothing(project),
                    follow_up,
                ))
                .await
                .expect("a page pinned to nothing must not reach the database");
            assert!(page.is_empty());
        }
    }
}

#[tokio::test]
async fn any_source_left_open_still_queries() {
    let repo = closed_repo().await;
    let open: [fn(&mut EntityFilterAst); 5] = [
        |filter| filter.calendar_event_filter = None,
        |filter| filter.document_filter = None,
        |filter| filter.chat_filter = None,
        |filter| filter.project_filter = None,
        |filter| {
            filter.agent_session_filter = Some(Arc::new(Expr::val(AgentSessionLiteral::Include)))
        },
    ];
    for (index, open) in open.into_iter().enumerate() {
        let mut filter = pinned_to_nothing(ProjectLiteral::ProjectId);
        open(&mut filter);
        let result = repo
            .expanded_generic_cursor_soup_with_projection(request(filter, false))
            .await;
        assert!(result.is_err(), "source {index} must still be queried");
    }
}
