use super::*;
use model::document::DocumentBasic;
use model_owner::Owner;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218141";

fn document(file_type: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: DOCUMENT.to_string(),
        document_name: "Poster".to_string(),
        owner: Owner::from_principal_str("macro|owner@user.com").unwrap(),
        file_type: Some(file_type.to_string()),
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

#[test]
fn legacy_not_uploaded_is_pending() {
    assert_eq!(
        DocumentContent::from_legacy_uploaded(false, Some(FileType::Pdf)),
        DocumentContent {
            state: DocumentContentState::Pending,
            location: None,
        }
    );
}

#[test]
fn legacy_uploaded_markdown_location_is_unknown() {
    assert_eq!(
        DocumentContent::from_legacy_uploaded(true, Some(FileType::Md)),
        DocumentContent::ready(DocumentContentLocation::Unknown)
    );
}

#[test]
fn legacy_uploaded_non_markdown_uses_object_storage() {
    assert_eq!(
        DocumentContent::from_legacy_uploaded(true, Some(FileType::Pdf)),
        DocumentContent::ready(DocumentContentLocation::ObjectStorage)
    );
}

#[test]
fn photoshop_documents_point_to_the_photoshop_tool() {
    for file_type in ["psd", "psb"] {
        let context = photoshop_attachment_context(&document(file_type)).unwrap();
        assert!(context.contains("Use ReadPhotoshopDocument"), "{context}");
        assert!(context.contains(DOCUMENT), "{context}");
    }
    assert_eq!(photoshop_attachment_context(&document("png")), None);
    assert_eq!(photoshop_attachment_context(&document("ai")), None);
}

#[test]
fn illustrator_documents_point_to_the_illustrator_tool() {
    let context = illustrator_attachment_context(&document("ai")).unwrap();
    assert!(context.contains("Use ReadIllustratorDocument"), "{context}");
    assert!(context.contains(DOCUMENT), "{context}");
    assert_eq!(illustrator_attachment_context(&document("eps")), None);
    assert_eq!(illustrator_attachment_context(&document("psd")), None);
}
