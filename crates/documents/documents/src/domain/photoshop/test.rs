use super::*;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use psd_engine::edit::{History, NewLayer, Op, Position};
use psd_engine::model::{ParagraphRun, TextLayer, TextRun};
use psd_engine::render::Renderer;
use psd_engine::{Document, Selection};

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218141";

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from("macro|photoshop@macro.com".to_owned()).unwrap(),
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
impl PhotoshopFiles for MemoryFiles {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, DOCUMENT);
        Ok(self.0.clone())
    }
}

fn service(bytes: Vec<u8>) -> PhotoshopService {
    PhotoshopService::new(Arc::new(MemoryFiles(bytes)))
}

/// Point text near the top left of the canvas, in the default style.
fn text_layer(text: &str) -> TextLayer {
    let length = text.encode_utf16().count() as u32;
    TextLayer {
        text: text.to_string(),
        runs: vec![TextRun {
            length,
            style: Default::default(),
        }],
        paragraphs: vec![ParagraphRun {
            length,
            align: Default::default(),
        }],
        transform: [1.0, 0.0, 0.0, 1.0, 4.0, 30.0],
        area: None,
        orientation: Default::default(),
        anti_alias: Default::default(),
        warped: false,
    }
}

/// A saved 64×48 document: the white Background, and above it a group
/// "Brand" holding a pixel layer "Logo" and a text layer "Headline" that
/// reads "Quarterly report".
fn document() -> Vec<u8> {
    let blank = psd_engine::save::blank_file(64, 48, true).expect("a blank document saves");
    let mut doc = Document::open(&blank).expect("the blank document opens");
    let mut renderer = Renderer::new();
    let mut history = History::default();
    let group = history
        .apply(
            &mut doc,
            &[Op::NewLayer {
                parent: None,
                position: Position::Top,
                name: Some("Brand".into()),
                kind: NewLayer::Group,
            }],
            &Selection::none(),
            &mut renderer,
            None,
        )
        .expect("the group is added")
        .created[0];
    history
        .apply(
            &mut doc,
            &[
                Op::NewLayer {
                    parent: Some(group),
                    position: Position::Top,
                    name: Some("Logo".into()),
                    kind: NewLayer::Pixel,
                },
                Op::NewLayer {
                    parent: Some(group),
                    position: Position::Top,
                    name: Some("Headline".into()),
                    kind: NewLayer::Text {
                        text: text_layer("Quarterly report"),
                    },
                },
            ],
            &Selection::none(),
            &mut renderer,
            None,
        )
        .expect("the layers are added");
    psd_engine::save::save(&doc, &mut renderer).expect("the document saves")
}

#[tokio::test]
async fn read_describes_the_canvas_layers_and_text() {
    let text = service(document())
        .read(receipt(AccessLevel::View))
        .await
        .unwrap();
    assert!(text.starts_with("Photoshop document: 64 × 48 px"), "{text}");
    for expected in [
        "\"Brand\"",
        "\"Logo\"",
        "\"Headline\"",
        "\"Quarterly report\"",
    ] {
        assert!(text.contains(expected), "{expected} in {text}");
    }
    let position = |name: &str| {
        text.find(name)
            .unwrap_or_else(|| panic!("{name} in {text}"))
    };
    assert!(
        position("\"Headline\"") < position("\"Background\""),
        "layers are listed top to bottom: {text}"
    );
    assert!(!text.contains("could not be decoded"), "{text}");
}

#[tokio::test]
async fn unreadable_files_are_reported_as_such() {
    let err = service(b"not a Photoshop document".to_vec())
        .read(receipt(AccessLevel::View))
        .await
        .unwrap_err();
    assert!(
        matches!(err.downcast_ref(), Some(PhotoshopError::Unreadable(_))),
        "{err:#}"
    );
}

#[tokio::test]
async fn hosts_without_a_file_store_fail_clearly() {
    let err = PhotoshopService::new(Arc::new(NoPhotoshopFiles))
        .read(receipt(AccessLevel::View))
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("cannot be opened"), "{err:#}");
}
