use super::*;

#[tokio::test]
async fn test_generate_upsert() {
    let document_info = DocumentMetadata {
        document_id: "AAA".to_string(),
        document_version_id: 0,
        owner: "macro|nobody@macro.com".to_string().try_into().unwrap(),
        document_name: "test_document".to_string(),
        file_type: Some("md".to_string()),
        sha: None,
        project_id: None,
        project_name: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        document_bom: None,
        modification_data: None,
        created_at: None,
        updated_at: None,
        sub_type: None,
        deleted_at: None,
    };

    let markdown_result = vec![
        MarkdownParseResult {
            node_id: "node1".to_string(),
            raw_content: "# Test Header".to_string(),
            content: "Test Header".to_string(),
        },
        MarkdownParseResult {
            node_id: "node2".to_string(),
            raw_content: "This is test content.".to_string(),
            content: "This is test content.".to_string(),
        },
    ];

    let upserts =
        generate_upserts(document_info, markdown_result).expect("Could not generate upserts");

    assert!(!upserts.is_empty());
    assert_eq!(upserts.len(), 2);
    assert_eq!(upserts[0].sub_type, None);
}

#[tokio::test]
async fn test_generate_upsert_with_sub_type() {
    use document_sub_type::DocumentSubType;

    let document_info = DocumentMetadata {
        document_id: "BBB".to_string(),
        document_version_id: 0,
        owner: "macro|nobody@macro.com".to_string().try_into().unwrap(),
        document_name: "test_task".to_string(),
        file_type: Some("md".to_string()),
        sha: None,
        project_id: None,
        project_name: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        document_bom: None,
        modification_data: None,
        created_at: None,
        updated_at: None,
        sub_type: Some(DocumentSubType::Task),
        deleted_at: None,
    };

    let markdown_result = vec![MarkdownParseResult {
        node_id: "node1".to_string(),
        raw_content: "# Task content".to_string(),
        content: "Task content".to_string(),
    }];

    let upserts =
        generate_upserts(document_info, markdown_result).expect("Could not generate upserts");

    assert_eq!(upserts.len(), 1);
    assert_eq!(upserts[0].sub_type, Some("task".to_string()));
}

fn parent_only_document_info(file_type: Option<&str>) -> DocumentMetadata {
    DocumentMetadata {
        document_id: "CCC".to_string(),
        document_version_id: 0,
        owner: "macro|nobody@macro.com".to_string().try_into().unwrap(),
        document_name: "pdf copy".to_string(),
        file_type: file_type.map(|ft| ft.to_string()),
        sha: None,
        project_id: None,
        project_name: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        document_bom: None,
        modification_data: None,
        created_at: None,
        updated_at: None,
        sub_type: None,
        deleted_at: None,
    }
}

#[test]
fn generate_upserts_preserves_a_bot_owner_principal() {
    const BOT_PRINCIPAL: &str = "bot|00000000-0000-0000-0000-00000000a1a1";

    let mut document_info = parent_only_document_info(Some("md"));
    document_info.owner = BOT_PRINCIPAL.to_string().try_into().unwrap();
    let markdown_result = vec![MarkdownParseResult {
        node_id: "node1".to_string(),
        raw_content: "# Bot document".to_string(),
        content: "Bot document".to_string(),
    }];

    let upserts = generate_upserts(document_info, markdown_result).expect("valid upsert");

    assert_eq!(upserts.len(), 1);
    assert_eq!(upserts[0].owner_id, BOT_PRINCIPAL);
}

#[test]
fn test_generate_parent_only_upsert() {
    let args = generate_parent_only_upsert(parent_only_document_info(Some("zip")))
        .expect("could not generate parent-only upsert")
        .expect("expected upsert args");

    assert_eq!(args.document_id, "CCC");
    assert_eq!(args.document_name, "pdf copy");
    assert_eq!(args.owner_id, "macro|nobody@macro.com");
    assert_eq!(args.file_type, "zip");
    assert_eq!(args.sub_type, None);
    assert_eq!(args.node_id, "");
    assert_eq!(args.content, "");
    assert_eq!(args.raw_content, None);
    assert!(args.properties.is_empty());
}

#[test]
fn test_canvas_routes_to_parent_only_indexing() {
    assert!(should_index_parent_only(&FileType::Canvas));
}

#[test]
fn test_generate_canvas_parent_only_upsert_has_no_content_chunk() {
    let args = generate_parent_only_upsert(parent_only_document_info(Some("canvas")))
        .expect("could not generate parent-only upsert")
        .expect("expected upsert args");

    assert_eq!(args.document_id, "CCC");
    assert_eq!(args.document_name, "pdf copy");
    assert_eq!(args.owner_id, "macro|nobody@macro.com");
    assert_eq!(args.file_type, "canvas");
    assert_eq!(args.node_id, "");
    assert_eq!(args.content, "");
    assert_eq!(args.raw_content, None);
    assert!(args.properties.is_empty());
}

#[test]
fn test_generate_parent_only_upsert_without_file_type() {
    let args = generate_parent_only_upsert(parent_only_document_info(None))
        .expect("could not generate parent-only upsert");

    assert!(args.is_none());
}
