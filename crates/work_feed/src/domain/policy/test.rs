use super::*;
use crate::domain::{models::WorkFeedMode, test_support::viewer_id};

#[test]
fn no_types_means_every_type() {
    assert_eq!(
        candidate_types(&[]),
        vec![
            EntityType::Document,
            EntityType::Chat,
            EntityType::Project,
            EntityType::Initiative,
            EntityType::EmailThread,
            EntityType::Channel,
            EntityType::ChannelMessage,
            EntityType::CalendarEvent,
            EntityType::ForeignEntity,
            EntityType::AgentSession,
        ]
    );
}

#[test]
fn types_keep_request_order_without_duplicates() {
    assert_eq!(
        candidate_types(&[
            WorkFeedItemType::Email,
            WorkFeedItemType::Document,
            WorkFeedItemType::Email,
        ]),
        vec![EntityType::EmailThread, EntityType::Document]
    );
}

fn scope(types: Vec<WorkFeedItemType>, include_snippets: bool) -> WorkFeedScope {
    WorkFeedScope {
        mode: WorkFeedMode::Work,
        types,
        include_snippets,
    }
}

#[test]
fn signal_filter_matches_home_signal() {
    let filter = signal_filter(&viewer_id(), &scope(Vec::new(), false));
    assert!(filter.document_filter.is_some(), "snippets are excluded");
    assert!(
        filter.agent_session_filter.is_some(),
        "agent sessions are opted in"
    );
    assert!(
        filter.initiative_filter.is_some(),
        "task projects are opted in"
    );
    assert!(filter.email_filter.tree.is_some());
    assert!(filter.channel_thread_filter.is_some());
    assert!(filter.foreign_entity_filter.is_some());

    let with_snippets = signal_filter(&viewer_id(), &scope(Vec::new(), true));
    assert!(with_snippets.document_filter.is_none());
}

#[test]
fn documents_and_tasks_narrow_each_other() {
    let is_task = || Expr::val(DocumentLiteral::SubType(DocumentSubType::Task));
    let json = |filter: Option<Expr<DocumentLiteral>>| serde_json::to_value(filter).unwrap();
    let document_filter = |types: Vec<WorkFeedItemType>, include_snippets: bool| {
        json(
            signal_filter(&viewer_id(), &scope(types, include_snippets))
                .document_filter
                .map(|filter| (*filter).clone()),
        )
    };

    assert_eq!(
        document_filter(
            vec![WorkFeedItemType::Document, WorkFeedItemType::Email],
            true
        ),
        json(Some(Expr::is_not(is_task())))
    );
    assert_eq!(
        document_filter(vec![WorkFeedItemType::Task], true),
        json(Some(is_task()))
    );
    assert_eq!(
        document_filter(
            vec![WorkFeedItemType::Task, WorkFeedItemType::Document],
            true
        ),
        json(None)
    );
    assert_eq!(
        document_filter(vec![WorkFeedItemType::Task], false),
        json(Some(Expr::and(
            is_task(),
            Expr::is_not(Expr::val(DocumentLiteral::SubType(
                DocumentSubType::Snippet
            )))
        )))
    );
}
