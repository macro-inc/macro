use super::*;
use ai_engine::edit::{History, NewNode, Op, Position};
use ai_engine::geom::Point;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218141";

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from("macro|illustrator@macro.com".to_owned()).unwrap(),
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
impl IllustratorFiles for MemoryFiles {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, DOCUMENT);
        Ok(self.0.clone())
    }
}

fn service(bytes: Vec<u8>) -> IllustratorService {
    IllustratorService::new(Arc::new(MemoryFiles(bytes)))
}

/// A saved letter-size document with one text object reading "Quarterly
/// report".
fn document() -> Vec<u8> {
    let blank = ai_engine::save::blank_file(612.0, 792.0).expect("a blank document saves");
    let mut doc = ai_engine::build::open(&blank)
        .expect("the blank document opens")
        .document;
    History::new()
        .apply(
            &mut doc,
            &[Op::Create {
                node: NewNode::Text {
                    at: Point { x: 72.0, y: 96.0 },
                    text: "Quarterly report".into(),
                    family: "Inter".into(),
                    style: "Regular".into(),
                    size: 24.0,
                    fill: None,
                    width: None,
                    align: Default::default(),
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("the text is added");
    ai_engine::save::save(&doc).expect("the document saves")
}

#[tokio::test]
async fn read_describes_the_artboards_layers_and_text() {
    let text = service(document())
        .read(receipt(AccessLevel::View))
        .await
        .unwrap();
    assert!(
        text.starts_with("Illustrator document: 1 artboard"),
        "{text}"
    );
    assert!(text.contains("Artboard"), "{text}");
    assert!(text.contains("[text]"), "{text}");
    assert!(text.contains("\"Quarterly report\""), "{text}");
}

#[tokio::test]
async fn postscript_era_files_are_reported_as_unreadable() {
    let legacy = b"%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(TM) 8.0\n%%EOF\n";
    let err = service(legacy.to_vec())
        .read(receipt(AccessLevel::View))
        .await
        .unwrap_err();
    assert!(
        matches!(err.downcast_ref(), Some(IllustratorError::Unreadable(_))),
        "{err:#}"
    );
    assert!(format!("{err:#}").contains("Illustrator 8"), "{err:#}");
}

#[tokio::test]
async fn unreadable_files_are_reported_as_such() {
    let err = service(b"not an Illustrator document".to_vec())
        .read(receipt(AccessLevel::View))
        .await
        .unwrap_err();
    assert!(
        matches!(err.downcast_ref(), Some(IllustratorError::Unreadable(_))),
        "{err:#}"
    );
}

#[tokio::test]
async fn hosts_without_a_file_store_fail_clearly() {
    let err = IllustratorService::new(Arc::new(NoIllustratorFiles))
        .read(receipt(AccessLevel::View))
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("cannot be opened"), "{err:#}");
}
