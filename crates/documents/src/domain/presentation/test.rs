use super::*;
use entity_access::domain::models::{Entity, EntityPermission, EntityType, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use pptx_engine::inspect::ShapeKindName;
use std::sync::Mutex;

const DOCUMENT: &str = "019fd3b9-3c6c-7c05-89c2-a27f01218140";
const DECK: &[u8] = include_bytes!(
    "../../../../pptx_engine/tests/corpus/generated/tables-financial-statement.pptx"
);

fn receipt<T: RequiredPermission>(access_level: AccessLevel) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from("macro|slides@macro.com".to_owned()).unwrap(),
        Entity {
            entity_id: DOCUMENT.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel { access_level },
    )
    .unwrap()
}

/// Versions of one document, newest last.
#[derive(Default)]
struct MemoryFiles {
    versions: Mutex<Vec<Vec<u8>>>,
}

impl MemoryFiles {
    fn with(bytes: &[u8]) -> Arc<Self> {
        Arc::new(Self {
            versions: Mutex::new(vec![bytes.to_vec()]),
        })
    }

    fn count(&self) -> usize {
        self.versions.lock().unwrap().len()
    }

    fn latest(&self) -> Vec<u8> {
        self.versions.lock().unwrap().last().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl PresentationFiles for MemoryFiles {
    async fn read(&self, document_id: &str) -> anyhow::Result<Vec<u8>> {
        assert_eq!(document_id, DOCUMENT);
        Ok(self.latest())
    }

    async fn write(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        assert_eq!(document_id, DOCUMENT);
        self.versions.lock().unwrap().push(bytes);
        Ok(())
    }
}

/// The first slide's id and its first text shape's id.
fn first_text_shape(bytes: &[u8]) -> (u32, u32) {
    let mut pres = Presentation::open(bytes.to_vec()).unwrap();
    let deck = pres.outline().unwrap();
    let slide = &deck.slides[0];
    let shape = slide
        .shapes
        .iter()
        .find(|s| s.text_editable && s.kind != ShapeKindName::Table)
        .expect("a text shape on the first slide");
    (slide.id, shape.id)
}

fn texts(bytes: &[u8]) -> Vec<String> {
    let mut pres = Presentation::open(bytes.to_vec()).unwrap();
    let deck = pres.outline().unwrap();
    deck.slides
        .iter()
        .flat_map(|s| s.shapes.iter())
        .flat_map(|s| s.paragraphs.iter().map(|p| p.text.clone()))
        .collect()
}

#[tokio::test]
async fn read_describes_shapes_tables_and_ids() {
    let service = PresentationService::new(MemoryFiles::with(DECK));
    let text = service
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap();
    assert!(text.starts_with("Presentation: "), "{text}");
    assert!(text.contains("\nSlide 1 (id "), "{text}");
    assert!(text.contains("(table"), "{text}");
    assert!(text.contains("row 0: | "), "{text}");
    assert!(text.contains("Theme colors: "), "{text}");
}

#[tokio::test]
async fn read_can_select_slides() {
    let service = PresentationService::new(MemoryFiles::with(DECK));
    let text = service
        .read(receipt(AccessLevel::View), Some(&[2]))
        .await
        .unwrap();
    assert!(text.contains("\nSlide 2 (id "), "{text}");
    assert!(!text.contains("\nSlide 1 (id "), "{text}");
}

#[tokio::test]
async fn edit_saves_one_new_version_and_describes_the_change() {
    let files = MemoryFiles::with(DECK);
    let service = PresentationService::new(files.clone());
    let (slide, shape) = first_text_shape(DECK);
    let outcome = service
        .edit(
            receipt(AccessLevel::Edit),
            &[
                EditOp::SetText {
                    slide,
                    shape,
                    cell: None,
                    text: "Quarterly results, restated".into(),
                },
                EditOp::AddSlide {
                    layout: None,
                    after: Some(slide),
                    title: Some("Appendix".into()),
                    body: None,
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(files.count(), 2, "exactly one new version");
    assert_eq!(outcome.document_id, DOCUMENT);
    assert!(outcome.structure_changed);
    assert_eq!(outcome.created.len(), 1);
    assert!(outcome.created[0].shape.is_none());
    assert!(
        outcome
            .changed_slides
            .contains("Quarterly results, restated"),
        "{}",
        outcome.changed_slides
    );
    let saved = texts(&files.latest());
    assert!(saved.iter().any(|t| t == "Quarterly results, restated"));
    assert!(saved.iter().any(|t| t == "Appendix"));
}

#[tokio::test]
async fn rejected_batches_save_nothing() {
    let files = MemoryFiles::with(DECK);
    let service = PresentationService::new(files.clone());
    let (slide, shape) = first_text_shape(DECK);
    let error = service
        .edit(
            receipt(AccessLevel::Edit),
            &[
                EditOp::SetText {
                    slide,
                    shape,
                    cell: None,
                    text: "Applied first".into(),
                },
                EditOp::DeleteShape {
                    slide,
                    shape: 99_999,
                },
            ],
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            error.downcast_ref::<PresentationError>(),
            Some(PresentationError::Rejected(_))
        ),
        "{error:#}"
    );
    assert!(error.to_string().contains("no changes were saved"));
    assert_eq!(files.count(), 1);
}

#[tokio::test]
async fn batch_size_is_bounded() {
    let files = MemoryFiles::with(DECK);
    let service = PresentationService::new(files.clone());
    let error = service
        .edit(receipt(AccessLevel::Edit), &[])
        .await
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<PresentationError>(),
        Some(PresentationError::BatchSize)
    ));
    let (slide, _) = first_text_shape(DECK);
    let too_many = vec![
        EditOp::SetSlideHidden {
            slide,
            hidden: false
        };
        MAX_OPERATIONS + 1
    ];
    assert!(
        service
            .edit(receipt(AccessLevel::Edit), &too_many)
            .await
            .is_err()
    );
    assert_eq!(files.count(), 1);
}

#[tokio::test]
async fn unreadable_files_are_reported() {
    let service = PresentationService::new(MemoryFiles::with(b"not a zip"));
    let error = service
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap_err();
    assert!(
        matches!(
            error.downcast_ref::<PresentationError>(),
            Some(PresentationError::Unreadable(_))
        ),
        "{error:#}"
    );
}

#[tokio::test]
async fn hosts_without_storage_fail_clearly() {
    let service = PresentationService::new(Arc::new(NoPresentationFiles));
    let error = service
        .read(receipt(AccessLevel::View), None)
        .await
        .unwrap_err();
    assert!(format!("{error:#}").contains("cannot be opened from this host"));
}

#[tokio::test]
async fn edited_copy_leaves_the_original_alone() {
    let files = MemoryFiles::with(DECK);
    let service = PresentationService::new(files.clone());
    let (slide, shape) = first_text_shape(DECK);
    let (copy, outcome) = service
        .edited_copy(
            receipt(AccessLevel::View),
            &[EditOp::SetText {
                slide,
                shape,
                cell: None,
                text: "Bonjour".into(),
            }],
        )
        .await
        .unwrap();
    assert!(texts(&copy).contains(&"Bonjour".to_owned()));
    assert!(
        outcome.changed_slides.contains("Bonjour"),
        "{}",
        outcome.changed_slides
    );
    // Nothing was written over the original.
    assert_eq!(files.count(), 1);
    assert!(!texts(&files.latest()).contains(&"Bonjour".to_owned()));
    // A copy without operations keeps the original bytes exactly.
    let (plain, _) = service
        .edited_copy(receipt(AccessLevel::View), &[])
        .await
        .unwrap();
    assert_eq!(plain, DECK);
}
