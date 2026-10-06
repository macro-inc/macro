use super::*;

#[test]
fn agent_sessions_respect_inclusion_and_nil_exclusion() {
    let all = SearchEntityFilters::from(EntityFilters::default());
    assert!(!all.should_include_agent_sessions);
    let all = SearchEntityFilters::from(entity_filters_from_include(
        vec![],
        EntityFilters::default(),
    ));
    assert!(all.should_include_agent_sessions);
    let only = SearchEntityFilters::from(entity_filters_from_include(
        vec![UnifiedSearchIndex::AgentSessions],
        EntityFilters::default(),
    ));
    assert!(only.should_include_agent_sessions);
    assert!(!only.should_include_chats);
    assert!(!only.should_include_documents);
    let legacy = SearchEntityFilters::from(entity_filters_from_include(
        vec![UnifiedSearchIndex::Chats],
        EntityFilters::default(),
    ));
    assert!(!legacy.should_include_agent_sessions);
    assert!(legacy.should_include_chats);
    let mut filters = EntityFilters::default();
    filters.agent_session_filters.ids = vec![
        NIL_UUID.into(),
        "00000000-0000-0000-0000-000000000001".into(),
    ];
    assert!(!SearchEntityFilters::from(filters).should_include_agent_sessions);
}

#[test]
fn empty_entity_type_filter_includes_channels() {
    let filters = SearchEntityFilters::from(entity_filters_from_include(
        vec![],
        EntityFilters::default(),
    ));

    assert!(filters.should_include_channels);
}

#[test]
fn channel_only_entity_type_filter_excludes_other_types() {
    let filters = SearchEntityFilters::from(entity_filters_from_include(
        vec![UnifiedSearchIndex::Channels],
        EntityFilters::default(),
    ));

    assert!(filters.should_include_channels);
    assert!(!filters.should_include_documents);
    assert!(!filters.should_include_chats);
    assert!(!filters.should_include_emails);
    assert!(!filters.should_include_projects);
    assert!(!filters.should_include_call_records);
}

#[test]
fn figma_designs_are_searchable_but_other_vector_files_are_not() {
    assert!(is_searchable_file_type(&FileType::Fig));
    assert!(is_searchable_file_type(&FileType::Md));
    assert!(!is_searchable_file_type(&FileType::Ai));
    assert!(!is_searchable_file_type(&FileType::Pptx));

    let mut filters = EntityFilters::default();
    filters.document_filters.file_types = vec!["fig".into(), "ai".into(), "pdf".into()];
    let expanded = SearchEntityFilters::from(filters)
        .document_filters
        .file_types;
    assert_eq!(expanded, ["fig", "pdf"]);
}
