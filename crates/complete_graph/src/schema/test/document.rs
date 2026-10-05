use super::*;
use documents::domain::{
    models::{DocumentError, DocumentViewMetadata, ViewedDocumentMetadata},
    ports::metadata::DocumentMetadataService,
};

pub(super) const LINK_DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000101";
const DENIED_ID: &str = "00000000-0000-0000-0000-000000000102";

#[derive(Default)]
struct MetadataService {
    reads: Mutex<Vec<(String, String)>>,
}

impl DocumentMetadataService for MetadataService {
    async fn viewed_metadata(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Option<ViewedDocumentMetadata>, DocumentError> {
        let entity_access::domain::models::EntityAccessAuth::Authenticated(user) = receipt.auth()
        else {
            panic!("document reads require the authenticated viewer's receipt");
        };
        self.reads
            .lock()
            .unwrap()
            .push((user.to_string(), receipt.entity().entity_id.clone()));
        let now = chrono::Utc::now();
        Ok(Some(ViewedDocumentMetadata {
            document: model::document::DocumentMetadata {
                document_id: receipt.entity().entity_id.clone(),
                document_version_id: 1,
                owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
                document_name: "Link-only CRM plan".to_string(),
                file_type: Some("md".to_string()),
                sha: None,
                project_id: None,
                project_name: None,
                branched_from_id: None,
                branched_from_version_id: None,
                document_family_id: None,
                document_bom: None,
                modification_data: None,
                created_at: Some(now),
                updated_at: Some(now),
                deleted_at: None,
                sub_type: None,
            },
            view: DocumentViewMetadata {
                viewed_at: Some(now),
            },
            is_completed: false,
        }))
    }
}

#[tokio::test]
async fn a_known_link_document_reads_metadata_and_edges_without_soup_membership() {
    let h = harness();
    let service = Arc::new(MetadataService::default());
    let query = format!(
        r#"{{ user {{ id document(documentId: "{LINK_DOCUMENT_ID}") {{
        __typename id name ownerId viewedAt properties {{ id }} activity {{ id }}
    }} }} }}"#
    );
    let response =
        h.schema
            .execute(h.request(&query, authenticated_parts()).data(
                crate::DocumentGraphqlContext::new(
                    service.clone(),
                    Arc::new(CountingEntityAccessService::default()),
                ),
            ))
            .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["id"], VALID_USER_ID);
    assert_eq!(data["user"]["document"]["id"], LINK_DOCUMENT_ID);
    assert_eq!(data["user"]["document"]["name"], "Link-only CRM plan");
    assert!(
        data["user"]["document"]["properties"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(h.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        *service.reads.lock().unwrap(),
        vec![(VALID_USER_ID.to_string(), LINK_DOCUMENT_ID.to_string())]
    );

    h.soup_service.set_raw_response(Vec::new());
    let discovery = h
        .execute(r#"{ user { soup(input: {initial: {limit: 10}}) {items {id}} } }"#)
        .await;
    assert!(discovery.errors.is_empty(), "{:?}", discovery.errors);
    assert!(
        discovery.data.into_json().unwrap()["user"]["soup"]["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn denied_ids_never_reach_the_document_service_even_in_a_history_batch() {
    let h = harness();
    let service = Arc::new(MetadataService::default());
    let query = format!(
        r#"{{ user {{
        document(documentId: "{DENIED_ID}") {{ id name }}
        documents(documentIds: ["{DENIED_ID}", "{LINK_DOCUMENT_ID}", "{LINK_DOCUMENT_ID}"]) {{id name}}
    }} }}"#
    );
    let response =
        h.schema
            .execute(h.request(&query, authenticated_parts()).data(
                crate::DocumentGraphqlContext::new(
                    service.clone(),
                    Arc::new(CountingEntityAccessService::default()),
                ),
            ))
            .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert!(data["user"]["document"].is_null());
    assert_eq!(data["user"]["documents"].as_array().unwrap().len(), 1);
    assert_eq!(service.reads.lock().unwrap().len(), 1);
    assert_eq!(h.raw_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_different_viewer_cannot_reuse_the_first_viewers_known_document() {
    let h = harness();
    let service = Arc::new(MetadataService::default());
    let query =
        format!(r#"{{ user {{ id document(documentId: "{LINK_DOCUMENT_ID}") {{id name}} }} }}"#);
    let response = h
        .schema
        .execute(
            h.request(&query, authenticated_parts())
                .data(
                    MacroUserIdStr::parse_from_str("macro|outsider@example.com")
                        .unwrap()
                        .into_owned(),
                )
                .data(crate::DocumentGraphqlContext::new(
                    service.clone(),
                    Arc::new(CountingEntityAccessService::default()),
                )),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["id"], "macro|outsider@example.com");
    assert!(data["user"]["document"].is_null());
    assert!(service.reads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn anonymous_or_unbounded_document_reads_do_not_read_metadata() {
    let h = harness();
    let query = format!(r#"{{ user {{ document(documentId: "{LINK_DOCUMENT_ID}") {{id}} }} }}"#);
    let anonymous = h.execute_with_parts(&query, bearer_parts("invalid")).await;
    assert!(!anonymous.errors.is_empty());
    let ids = std::iter::repeat_n(format!("\"{LINK_DOCUMENT_ID}\""), 101)
        .collect::<Vec<_>>()
        .join(",");
    let query = format!("{{user {{ documents(documentIds: [{ids}]) {{id}} }} }}");
    let response = h.execute(&query).await;
    assert!(!response.errors.is_empty());
    assert_eq!(h.raw_soup_calls.load(Ordering::SeqCst), 0);
}
