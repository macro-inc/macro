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

#[test]
fn test_design_content_is_indexed_but_other_vector_files_are_name_only() {
    for design in [FileType::Fig, FileType::Psd, FileType::Psb, FileType::Ai] {
        assert!(!should_index_parent_only(&design), "{design}");
    }
    assert!(should_index_parent_only(&FileType::Eps));
    assert!(should_index_parent_only(&FileType::Dwg));
}

#[test]
fn raw_document_key_is_under_the_stored_owner() {
    let owner: Owner = "macro|owner@macro.com".to_string().try_into().unwrap();
    let message = |user_id: &str, version: Option<&str>| SearchExtractorMessage {
        user_id: user_id.to_string(),
        document_id: "DDD".to_string(),
        file_type: FileType::Md,
        document_version_id: version.map(str::to_string),
        index_override: None,
    };
    let latest = build_cloud_storage_bucket_document_key(&owner, "DDD", "7");
    let converted = build_docx_to_pdf_converted_document_key(&owner, "DDD");

    let check = |message: SearchExtractorMessage, version: &str, expected: Option<&str>| {
        assert_eq!(
            raw_document_key(&owner, &message, version).as_deref(),
            expected,
            "{message:?} at version {version}"
        );
    };

    check(message("", None), "7", Some(&latest));
    check(message("", Some("7")), "7", Some(&latest));
    check(
        message("macro|other@macro.com", Some("7")),
        "7",
        Some(&latest),
    );
    check(message("", Some("6")), "7", None);
    check(
        message("", Some(CONVERTED_DOCUMENT_FILE_NAME)),
        CONVERTED_DOCUMENT_FILE_NAME,
        Some(&converted),
    );
}

/// The document in `basic_versioned_document`: a PDF uploaded as version 1
/// and saved again as version 2, so it is served from version 1.
const SAVED_PDF: &str = "document-one";
const BUCKET: &str = "document-storage";

fn saved_pdf_message(file_type: FileType, version: &str) -> SearchExtractorMessage {
    SearchExtractorMessage {
        user_id: "macro|user@user.com".to_string(),
        document_id: SAVED_PDF.to_string(),
        file_type,
        document_version_id: Some(version.to_string()),
        index_override: None,
    }
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../../crates/macro_db_client/fixtures",
        scripts("basic_versioned_document")
    )
)]
async fn a_pdf_is_indexed_from_the_version_it_is_served_from(pool: sqlx::PgPool) {
    let owner: Owner = "macro|user@user.com".to_string().try_into().unwrap();
    let served = build_cloud_storage_bucket_document_key(&owner, SAVED_PDF, 1);
    let latest = build_cloud_storage_bucket_document_key(&owner, SAVED_PDF, 2);
    let converted = build_docx_to_pdf_converted_document_key(&owner, SAVED_PDF);

    for (file_type, version, expected) in [
        (FileType::Pdf, "1", Some(&served)),
        (FileType::Pdf, "2", None),
        (
            FileType::Pdf,
            CONVERTED_DOCUMENT_FILE_NAME,
            Some(&converted),
        ),
        (
            FileType::Docx,
            CONVERTED_DOCUMENT_FILE_NAME,
            Some(&converted),
        ),
        (FileType::Md, "1", None),
        (FileType::Md, "2", Some(&latest)),
    ] {
        let message = saved_pdf_message(file_type, version);
        let indexed = indexed_version_id(&pool, &message, 2).await.unwrap();
        assert_eq!(
            raw_document_key(&owner, &message, &indexed).as_ref(),
            expected,
            "{file_type} at version {version}"
        );
    }
}

type Requests = std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>;

/// Stands in for both S3 and OpenSearch: every object read returns `object`,
/// and each request is recorded as `METHOD path` with its body.
async fn fake_storage(object: &'static [u8]) -> (String, Requests) {
    use axum::{
        Json,
        body::Bytes,
        http::{Method, StatusCode, Uri},
        response::IntoResponse,
    };

    let requests = Requests::default();
    let recorded = requests.clone();
    let app = axum::Router::new().fallback(move |method: Method, uri: Uri, body: Bytes| {
        let recorded = recorded.clone();
        async move {
            let path = uri.path().to_string();
            recorded.lock().unwrap().push((
                format!("{method} {path}"),
                String::from_utf8_lossy(&body).into_owned(),
            ));
            if method == Method::GET {
                object.into_response()
            } else if path.ends_with("/_delete_by_query") {
                Json(serde_json::json!({ "deleted": 1 })).into_response()
            } else if path.ends_with("/_bulk") {
                Json(serde_json::json!({
                    "errors": false,
                    "items": [{ "index": { "status": 201 } }],
                }))
                .into_response()
            } else {
                StatusCode::NOT_FOUND.into_response()
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (endpoint, requests)
}

fn fake_s3(endpoint: &str) -> s3_client::S3 {
    use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};

    s3_client::S3::new(aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new("test", "test", None, None, "test"))
            .endpoint_url(endpoint)
            .force_path_style(true)
            .retry_config(RetryConfig::disabled())
            .build(),
    ))
}

fn fake_opensearch(endpoint: &str) -> OpensearchClient {
    OpensearchClient::new(endpoint.to_string(), String::new(), String::new()).unwrap()
}

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../../crates/macro_db_client/fixtures",
        scripts("basic_versioned_document")
    )
)]
async fn a_message_for_a_version_the_pdf_is_not_served_from_changes_nothing(pool: sqlx::PgPool) {
    let (endpoint, requests) = fake_storage(b"not a pdf").await;

    update_search_with_raw_document(
        &fake_opensearch(&endpoint),
        &pool,
        &fake_s3(&endpoint),
        BUCKET,
        &saved_pdf_message(FileType::Pdf, "2"),
    )
    .await
    .unwrap();

    assert_eq!(*requests.lock().unwrap(), Vec::new());
}

#[cfg(feature = "pdf")]
#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../../crates/macro_db_client/fixtures",
        scripts("basic_versioned_document")
    )
)]
async fn an_unreadable_pdf_is_indexed_by_name_only(pool: sqlx::PgPool) {
    let (endpoint, requests) = fake_storage(b"not a pdf").await;

    update_search_with_raw_document(
        &fake_opensearch(&endpoint),
        &pool,
        &fake_s3(&endpoint),
        BUCKET,
        &saved_pdf_message(FileType::Pdf, "1"),
    )
    .await
    .expect("an unreadable pdf is not an error to retry");

    let requests = requests.lock().unwrap().clone();
    let lines: Vec<&str> = requests.iter().map(|(line, _)| line.as_str()).collect();
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert!(
        lines[0].starts_with(&format!("GET /{BUCKET}/")) && lines[0].ends_with("/document-one/1"),
        "{lines:?}"
    );
    assert_eq!(lines[1], "POST /documents/_delete_by_query");
    assert_eq!(lines[2], "POST /documents/_bulk");
    let bulk: Vec<serde_json::Value> = requests[2]
        .1
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(bulk.len(), 2, "only the parent doc is written: {bulk:?}");
    assert_eq!(bulk[1]["document_name"], "test_document_name");
    assert_eq!(bulk[1]["document_relation"], "document");
}

#[tokio::test]
async fn test_unreadable_designs_are_read_errors() {
    for file_type in [FileType::Psd, FileType::Psb, FileType::Ai, FileType::Md] {
        let read = read_design_text(file_type, b"not a design".to_vec()).await;
        assert!(read.is_err(), "{file_type}");
    }
}
