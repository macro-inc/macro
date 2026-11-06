use super::*;
use crate::domain::presentation::{PresentationFiles, PresentationService};
use pptx_engine::{Presentation, inspect::ShapeKindName};

const DECK_ID: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218140";
const PROJECT_ID: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_0456);
const DECK: &[u8] = include_bytes!(
    "../../../../../pptx_engine/tests/corpus/generated/tables-financial-statement.pptx"
);

/// Versions of one deck, newest last.
struct MemoryDeck {
    versions: Mutex<Vec<Vec<u8>>>,
}

#[async_trait]
impl PresentationFiles for MemoryDeck {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, DECK_ID);
        Ok(self.versions.lock().unwrap().last().unwrap().clone())
    }

    async fn write(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        assert_eq!(document_id, DECK_ID);
        self.versions.lock().unwrap().push(bytes);
        Ok(())
    }
}

/// A router over one stored deck, with documents reporting `file_type`.
fn deck_router(
    file_type: FileType,
) -> (
    Router,
    Arc<MemoryDeck>,
    Arc<FakeDocumentService>,
    FakeEntityAccessService,
) {
    let (mut state, documents, access, _) = test_state(NonUserOwners::Disabled);
    *documents.file_type.lock().unwrap() = Some(file_type);
    // Someone else's document, so the caller's access is checked.
    *documents.document_owner.lock().unwrap() =
        Some(Owner::from_principal_str("macro|file-owner@example.com").unwrap());
    let deck = Arc::new(MemoryDeck {
        versions: Mutex::new(vec![DECK.to_vec()]),
    });
    state.presentations = Arc::new(PresentationService::new(deck.clone()));
    (router_for(state), deck, documents, access)
}

/// The first slide's id and its first text shape's id.
fn first_text_shape(bytes: &[u8]) -> (u32, u32) {
    let mut presentation = Presentation::open(bytes.to_vec()).unwrap();
    let outline = presentation.outline().unwrap();
    let slide = &outline.slides[0];
    let shape = slide
        .shapes
        .iter()
        .find(|shape| shape.text_editable && shape.kind != ShapeKindName::Table)
        .unwrap();
    (slide.id, shape.id)
}

fn texts(bytes: &[u8]) -> Vec<String> {
    let mut presentation = Presentation::open(bytes.to_vec()).unwrap();
    let outline = presentation.outline().unwrap();
    outline
        .slides
        .iter()
        .flat_map(|slide| slide.shapes.iter())
        .flat_map(|shape| shape.paragraphs.iter().map(|p| p.text.clone()))
        .collect()
}

fn post_json(path: &str, body: Value) -> Request<Body> {
    with_jwt(Request::post(path).header("content-type", "application/json"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn read_describes_only_the_requested_slides_with_view_access() {
    let (router, _, _, access) = deck_router(FileType::Pptx);

    let (status, body) = send(
        &router,
        with_jwt(Request::get(format!("/{DECK_ID}/presentation?slide=2")))
            .body(Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let content = body["content"].as_str().unwrap();
    assert!(content.starts_with("Presentation: "), "{content}");
    assert!(content.contains("\nSlide 2 (id "), "{content}");
    assert!(!content.contains("\nSlide 1 (id "), "{content}");
    assert_eq!(
        access
            .document_access_calls()
            .iter()
            .map(|call| (
                call.user_id.as_str(),
                call.entity_id.as_str(),
                call.entity_type
            ))
            .collect::<Vec<_>>(),
        [(JWT_USER_ID, DECK_ID, EntityType::Document)]
    );
}

#[tokio::test]
async fn read_refuses_documents_that_are_not_decks() {
    let (router, _, _, _) = deck_router(FileType::Pdf);

    let (status, body) = send(
        &router,
        with_jwt(Request::get(format!("/{DECK_ID}/presentation")))
            .body(Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            json!({ "message": "bad request: the document is not a PowerPoint (.pptx) presentation" })
        )
    );
}

#[tokio::test]
async fn edit_saves_one_new_version_and_returns_the_changed_slides() {
    let (router, deck, _, _) = deck_router(FileType::Pptx);
    let (slide, shape) = first_text_shape(DECK);

    let (status, body) = send(
        &router,
        post_json(
            &format!("/{DECK_ID}/presentation/edits"),
            json!({ "operations": [
                { "op": "setText", "slide": slide, "shape": shape, "text": "Quarterly results, restated" }
            ] }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["documentId"], DECK_ID);
    assert_eq!(body["structureChanged"], false);
    assert!(
        body["changedSlides"]
            .as_str()
            .unwrap()
            .contains("Quarterly results, restated"),
        "{body}"
    );
    let versions = deck.versions.lock().unwrap();
    assert_eq!(versions.len(), 2);
    assert!(
        texts(&versions[1])
            .iter()
            .any(|text| text == "Quarterly results, restated")
    );
}

#[tokio::test]
async fn an_operation_the_deck_rejects_saves_nothing() {
    let (router, deck, _, _) = deck_router(FileType::Pptx);

    let (status, body) = send(
        &router,
        post_json(
            &format!("/{DECK_ID}/presentation/edits"),
            json!({ "operations": [
                { "op": "setText", "slide": 999_999, "shape": 2, "text": "Nowhere" }
            ] }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .ends_with("(no changes were saved)"),
        "{body}"
    );
    assert_eq!(deck.versions.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn edit_without_edit_access_saves_nothing() {
    let (router, deck, _, access) = deck_router(FileType::Pptx);
    access.deny_document_access();
    let (slide, shape) = first_text_shape(DECK);

    let status = send_status(
        &router,
        post_json(
            &format!("/{DECK_ID}/presentation/edits"),
            json!({ "operations": [
                { "op": "setText", "slide": slide, "shape": shape, "text": "Denied" }
            ] }),
        ),
    )
    .await;

    assert!(status.is_client_error(), "{status}");
    assert_eq!(deck.versions.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn copy_creates_the_edited_deck_in_the_project_and_leaves_the_original() {
    let (router, deck, documents, access) = deck_router(FileType::Pptx);
    let (url, uploaded) = super::upload_file::object_storage().await;
    *documents.upload_url.lock().unwrap() = Some(url);
    let (slide, shape) = first_text_shape(DECK);

    let (status, body) = send(
        &router,
        post_json(
            &format!("/{DECK_ID}/presentation/copy"),
            json!({
                "name": "Results (French).pptx",
                "projectId": PROJECT_ID,
                "operations": [
                    { "op": "setText", "slide": slide, "shape": shape, "text": "Résultats trimestriels" }
                ]
            }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["documentId"], "created-document");
    assert_eq!(
        *documents.created_documents.lock().unwrap(),
        [CreatedDocumentCall {
            document_name: "Results (French)".to_string(),
            file_type: Some(FileType::Pptx),
            project_id: Some(PROJECT_ID),
        }]
    );
    let uploaded = uploaded.lock().unwrap();
    assert_eq!(uploaded.len(), 1);
    assert!(
        texts(&uploaded[0])
            .iter()
            .any(|text| text == "Résultats trimestriels")
    );
    assert_eq!(deck.versions.lock().unwrap().len(), 1, "original unchanged");
    assert_eq!(
        access
            .document_access_calls()
            .iter()
            .map(|call| (call.entity_id.clone(), call.entity_type))
            .collect::<Vec<_>>(),
        [
            (DECK_ID.to_string(), EntityType::Document),
            (PROJECT_ID.to_string(), EntityType::Project),
        ]
    );
}

#[tokio::test]
async fn copy_into_a_project_without_edit_access_creates_nothing() {
    let (router, _, documents, access) = deck_router(FileType::Pptx);
    access.deny_access_to(EntityType::Project);

    let status = send_status(
        &router,
        post_json(
            &format!("/{DECK_ID}/presentation/copy"),
            json!({ "name": "Copy", "projectId": PROJECT_ID }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(documents.created_documents.lock().unwrap().is_empty());
}

/// Every property name anywhere in a JSON schema document.
fn property_names(schema: &Value, names: &mut std::collections::BTreeSet<String>) {
    match schema {
        Value::Object(object) => {
            if let Some(Value::Object(properties)) = object.get("properties") {
                names.extend(properties.keys().cloned());
            }
            for value in object.values() {
                property_names(value, names);
            }
        }
        Value::Array(items) => {
            for item in items {
                property_names(item, names);
            }
        }
        _ => {}
    }
}

/// The OpenAPI schema clients are generated from names the fields serde
/// reads, as the tools' JSON Schema does.
fn assert_openapi_matches_json_schema<T: utoipa::ToSchema + schemars::JsonSchema>() {
    let mut openapi = vec![("root".to_string(), T::schema())];
    T::schemas(&mut openapi);
    let mut openapi_names = std::collections::BTreeSet::new();
    property_names(&serde_json::to_value(&openapi).unwrap(), &mut openapi_names);

    let mut json_schema_names = std::collections::BTreeSet::new();
    property_names(
        &serde_json::to_value(schemars::schema_for!(T)).unwrap(),
        &mut json_schema_names,
    );

    assert_eq!(openapi_names, json_schema_names);
}

#[test]
fn edit_operations_name_the_same_fields_in_both_schemas() {
    assert_openapi_matches_json_schema::<pptx_engine::EditOp>();
    assert_openapi_matches_json_schema::<crate::domain::word_document::WordDocumentOperation>();
}
