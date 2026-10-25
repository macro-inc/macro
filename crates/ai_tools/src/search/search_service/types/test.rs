use super::*;

#[test]
fn searches_include_sessions_by_default_and_never_include_legacy_chats() {
    let filters = search_filters(&[], item_filters::EntityFilters::default());
    assert!(filters.agent_session_filters.include);
    assert_eq!(
        filters.chat_filters.chat_ids,
        vec![uuid::Uuid::nil().to_string()]
    );
    let filters = search_filters(
        &[SearchEntityType::AgentSessions],
        item_filters::EntityFilters::default(),
    );
    assert!(filters.agent_session_filters.include);
    assert_eq!(
        filters.document_filters.document_ids,
        vec![uuid::Uuid::nil().to_string()]
    );
    assert!(serde_json::from_str::<SearchEntityType>("\"chats\"").is_err());
}
