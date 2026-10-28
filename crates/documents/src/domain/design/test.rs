use super::*;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218141";
/// Components with properties, a component set, instances on a screen, and
/// fill, text, and effect styles.
const DESIGN_SYSTEM: &[u8] =
    include_bytes!("../../../../fig_engine/tests/fixtures/design-system.fig");
/// A variable collection with two modes.
const VARIABLES: &[u8] = include_bytes!("../../../../fig_engine/tests/fixtures/variables.fig");

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from("macro|designs@macro.com".to_owned()).unwrap(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

struct MemoryFiles(Vec<u8>);

#[async_trait::async_trait]
impl DesignFiles for MemoryFiles {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, DOCUMENT);
        Ok(self.0.clone())
    }
}

fn service(bytes: &[u8]) -> DesignService {
    DesignService::new(Arc::new(MemoryFiles(bytes.to_vec())))
}

#[tokio::test]
async fn read_describes_pages_text_components_and_styles() {
    let text = service(DESIGN_SYSTEM)
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap();
    assert!(text.starts_with("Design: "), "{text}");
    assert!(text.contains("\nPage 1 \"Screens\" (id "), "{text}");
    assert!(text.contains("\nPage 2 \"Components\" (id "), "{text}");
    assert!(text.contains("  Frame \"Screen\" (id "), "{text}");
    assert!(
        text.contains("text \"Welcome\" (layer \"Heading\""),
        "{text}"
    );
    assert!(text.contains("instances: "), "{text}");
    assert!(text.contains("\"Card\" (component, id "), "{text}");
    assert!(
        text.contains("property \"Title\" (TEXT, default \"Card title\")"),
        "{text}"
    );
    assert!(text.contains("(component set, id "), "{text}");
    assert!(
        text.contains("variant property \"Type\": Primary | Secondary"),
        "{text}"
    );
    assert!(text.contains("\nStyles:\n"), "{text}");
    assert!(text.contains("FILL \"Brand/Primary\""), "{text}");
    assert!(!text.contains("Truncated"), "{text}");
}

#[tokio::test]
async fn read_can_select_pages() {
    let text = service(DESIGN_SYSTEM)
        .read(receipt(AccessLevel::View), Some(&[2, 7]))
        .await
        .unwrap();
    assert!(text.contains("\nPage 2 \"Components\""), "{text}");
    assert!(!text.contains("\nPage 1 "), "{text}");
    assert!(
        text.contains("(No page 7: pages are numbered 1 to 2.)"),
        "{text}"
    );
}

#[tokio::test]
async fn read_lists_variables() {
    let text = service(VARIABLES)
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap();
    assert!(
        text.contains("collection \"Theme\" (modes: Light, Dark)"),
        "{text}"
    );
    assert!(text.contains("COLOR \"Surface\""), "{text}");
}

#[tokio::test]
async fn unreadable_files_are_reported_as_such() {
    let err = service(b"not a design")
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap_err();
    assert!(
        matches!(err.downcast_ref(), Some(DesignError::Unreadable(_))),
        "{err:#}"
    );
}

#[tokio::test]
async fn hosts_without_a_file_store_fail_clearly() {
    let err = DesignService::new(Arc::new(NoDesignFiles))
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("cannot be opened"), "{err:#}");
}
