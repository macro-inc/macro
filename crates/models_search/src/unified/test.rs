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
fn nil_call_ids_exclude_call_records() {
    let mut filters = EntityFilters::default();
    filters.call_filters.call_ids = vec![NIL_UUID.into()];
    let excluded = SearchEntityFilters::from(filters);
    assert!(!excluded.should_include_call_records);
    assert!(excluded.call_filters.call_ids.is_empty());

    let mut filters = EntityFilters::default();
    filters.call_filters.channel_ids = vec![NIL_UUID.into()];
    assert!(!SearchEntityFilters::from(filters).should_include_call_records);

    let mut filters = EntityFilters::default();
    filters.call_filters.call_ids = vec!["00000000-0000-0000-0000-000000000001".into()];
    let one_call = SearchEntityFilters::from(filters);
    assert!(one_call.should_include_call_records);
    assert_eq!(
        one_call.call_filters.call_ids,
        ["00000000-0000-0000-0000-000000000001"]
    );

    assert!(SearchEntityFilters::from(EntityFilters::default()).should_include_call_records);
}

#[test]
fn design_files_are_searchable_but_other_vector_files_are_not() {
    for design in [FileType::Fig, FileType::Psd, FileType::Psb, FileType::Ai] {
        assert!(is_searchable_file_type(&design), "{design}");
    }
    assert!(is_searchable_file_type(&FileType::Md));
    assert!(!is_searchable_file_type(&FileType::Eps));
    assert!(!is_searchable_file_type(&FileType::Dwg));
    assert!(!is_searchable_file_type(&FileType::Pptx));

    let mut filters = EntityFilters::default();
    filters.document_filters.file_types = vec![
        "fig".into(),
        "ai".into(),
        "eps".into(),
        "psd".into(),
        "pdf".into(),
    ];
    let expanded = SearchEntityFilters::from(filters)
        .document_filters
        .file_types;
    assert_eq!(expanded, ["fig", "ai", "psd", "pdf"]);

    let mut filters = EntityFilters::default();
    filters.document_filters.file_types = vec!["assoc:vector".into()];
    let expanded = SearchEntityFilters::from(filters)
        .document_filters
        .file_types;
    assert_eq!(expanded, ["ai", "fig", "psd", "psb"]);
}
