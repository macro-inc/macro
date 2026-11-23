use super::*;
use crate::domain::{
    design::{DesignFiles, DesignService},
    illustrator::{IllustratorFiles, IllustratorService},
    photoshop::{PhotoshopFiles, PhotoshopService},
};

const FILE_ID: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218142";
const DESIGN_SYSTEM: &[u8] =
    include_bytes!("../../../../../fig_engine/tests/fixtures/design-system.fig");

/// One stored file, whatever kind of design file it is.
struct StoredFile(Vec<u8>);

#[async_trait]
impl DesignFiles for StoredFile {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, FILE_ID);
        Ok(self.0.clone())
    }
}

#[async_trait]
impl PhotoshopFiles for StoredFile {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, FILE_ID);
        Ok(self.0.clone())
    }
}

#[async_trait]
impl IllustratorFiles for StoredFile {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, FILE_ID);
        Ok(self.0.clone())
    }
}

fn file_router(file_type: FileType, bytes: &[u8]) -> (Router, FakeEntityAccessService) {
    let (mut state, documents, access, _) = test_state(NonUserOwners::Disabled);
    *documents.file_type.lock().unwrap() = Some(file_type);
    // Someone else's document, so the caller's access is checked.
    *documents.document_owner.lock().unwrap() =
        Some(Owner::from_principal_str("macro|file-owner@example.com").unwrap());
    let file = Arc::new(StoredFile(bytes.to_vec()));
    state.designs = Arc::new(DesignService::new(file.clone()));
    state.photoshop_documents = Arc::new(PhotoshopService::new(file.clone()));
    state.illustrator_documents = Arc::new(IllustratorService::new(file));
    (router_for(state), access)
}

fn get(path: &str) -> Request<Body> {
    with_jwt(Request::get(path)).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn a_design_reads_only_the_requested_pages_with_view_access() {
    let (router, access) = file_router(FileType::Fig, DESIGN_SYSTEM);

    let (status, body) = send(&router, get(&format!("/{FILE_ID}/design?page=2"))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let content = body["content"].as_str().unwrap();
    assert!(content.starts_with("Design: "), "{content}");
    assert!(content.contains("\nPage 2 \"Components\""), "{content}");
    assert!(!content.contains("\nPage 1 "), "{content}");
    assert_eq!(
        access.document_access_calls()[0].entity_id,
        FILE_ID.to_string()
    );
}

#[tokio::test]
async fn files_the_readers_cannot_open_are_reported_to_the_caller() {
    for (file_type, path, message) in [
        (
            FileType::Fig,
            "design",
            "bad request: the document is not a readable Figma (.fig) file",
        ),
        (
            FileType::Psd,
            "photoshop",
            "bad request: the document is not a readable Photoshop (.psd or .psb) file",
        ),
        (
            FileType::Ai,
            "illustrator",
            "bad request: the document is not a readable Illustrator (.ai) file",
        ),
    ] {
        let (router, _) = file_router(file_type, b"not a design file");

        let (status, body) = send(&router, get(&format!("/{FILE_ID}/{path}"))).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert!(
            body["message"].as_str().unwrap().starts_with(message),
            "{body}"
        );
    }
}

#[tokio::test]
async fn each_reader_refuses_other_file_types() {
    for path in ["design", "photoshop", "illustrator"] {
        let (router, _) = file_router(FileType::Pdf, b"%PDF-1.7");

        let status = send_status(&router, get(&format!("/{FILE_ID}/{path}"))).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
    }
}

#[tokio::test]
async fn reads_without_view_access_are_denied() {
    let (router, access) = file_router(FileType::Fig, DESIGN_SYSTEM);
    access.deny_document_access();

    let status = send_status(&router, get(&format!("/{FILE_ID}/design"))).await;

    assert!(status.is_client_error(), "{status}");
}
