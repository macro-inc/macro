use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::{FileInput, SceneInput, Theme};
use crate::testing::{
    FakeCanvases, FakeTokens, MemoryDocuments, MemoryObjectStore, MemoryRepository,
    RecordingNotifier,
};

const DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f";
const ALICE: &str = "macro|alice@artifacts.test";
const PAGE_SHA: &str = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";
const CSS_SHA: &str = "7c98040a541657584690ae2a1cc3b42a8b53b159cc60c5d3abbfecbaeac6c94a";

type TestService = ArtifactServiceImpl<
    MemoryRepository,
    MemoryObjectStore,
    MemoryDocuments,
    FakeTokens,
    RecordingNotifier,
    FakeCanvases,
>;

fn service() -> TestService {
    ArtifactServiceImpl::new(
        MemoryRepository::default(),
        MemoryObjectStore::default(),
        MemoryDocuments::new(DOCUMENT_ID),
        FakeTokens::default(),
        RecordingNotifier::default(),
        FakeCanvases::default(),
        ContentOrigin {
            scheme: "https".to_string(),
            host: "artifacts.test".to_string(),
            port: None,
        },
    )
}

fn alice() -> CreationPrincipal {
    CreationPrincipal::User(MacroUserIdStr::parse_from_str(ALICE).unwrap())
}

fn alice_publishing() -> Publisher {
    Publisher {
        user_id: ALICE.to_string(),
        agent: None,
    }
}

fn edit_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(ALICE).unwrap(),
        DOCUMENT_ID,
        EntityType::Document,
    )
}

fn view_receipt() -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(ALICE).unwrap(),
        DOCUMENT_ID,
        EntityType::Document,
    )
}

#[tokio::test]
async fn create_stores_the_document_version_one_and_its_bytes() {
    let service = service();

    let artifact = service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: " Onboarding ".to_string(),
                project_id: None,
                files: vec![FileInput {
                    path: "index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: Some(b"<h1>Hi</h1>".to_vec()),
                }],
                scenes: vec![],
                message: Some("  ".to_string()),
            },
        )
        .await
        .unwrap();

    assert_eq!(artifact.document_id, DOCUMENT_ID);
    assert_eq!(artifact.name, "Onboarding");
    assert_eq!(artifact.owner, ALICE);
    let current = artifact.current.unwrap();
    assert_eq!(current.number, 1);
    assert_eq!(current.message, None);
    assert_eq!(current.created_by, ALICE);
    assert_eq!(current.created_by_agent, None);
    assert_eq!(
        service
            .object_store
            .objects
            .lock()
            .unwrap()
            .get(&(DOCUMENT_ID.to_string(), PAGE_SHA.to_string())),
        Some(&b"<h1>Hi</h1>".to_vec())
    );
}

#[tokio::test]
async fn create_rejects_an_invalid_bundle_before_creating_the_document() {
    let service = service();

    let result = service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Onboarding".to_string(),
                project_id: None,
                files: vec![FileInput {
                    path: "../index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: Some(b"<h1>Hi</h1>".to_vec()),
                }],
                scenes: vec![],
                message: None,
            },
        )
        .await;

    assert!(matches!(result, Err(ArtifactError::BadRequest(_))));
    assert!(service.documents.documents.lock().unwrap().is_empty());
}

#[tokio::test]
async fn publish_reuses_stored_files_and_records_the_agent() {
    let service = service();
    service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Onboarding".to_string(),
                project_id: None,
                files: vec![
                    FileInput {
                        path: "index.html".to_string(),
                        content_type: "text/html".to_string(),
                        sha256: PAGE_SHA.to_string(),
                        content: Some(b"<h1>Hi</h1>".to_vec()),
                    },
                    FileInput {
                        path: "theme.css".to_string(),
                        content_type: "text/css".to_string(),
                        sha256: CSS_SHA.to_string(),
                        content: Some(b"body{}".to_vec()),
                    },
                ],
                scenes: vec![],
                message: None,
            },
        )
        .await
        .unwrap();

    let agent = Publisher {
        user_id: ALICE.to_string(),
        agent: Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string()),
    };
    let version = service
        .publish(
            edit_receipt(),
            &agent,
            PublishVersion {
                files: vec![
                    FileInput {
                        path: "index.html".to_string(),
                        content_type: "text/html".to_string(),
                        sha256: PAGE_SHA.to_string(),
                        content: None,
                    },
                    FileInput {
                        path: "styles/theme.css".to_string(),
                        content_type: "text/css".to_string(),
                        sha256: CSS_SHA.to_string(),
                        content: None,
                    },
                ],
                scenes: vec![SceneInput {
                    id: "home".to_string(),
                    title: "Home".to_string(),
                    path: "index.html".to_string(),
                }],
                message: Some("Move the theme".to_string()),
                base_version: Some(1),
            },
        )
        .await
        .unwrap();

    assert_eq!(version.number, 2);
    assert_eq!(version.manifest.total_size(), 11 + 6);
    assert_eq!(version.message.as_deref(), Some("Move the theme"));
    assert_eq!(version.created_by, ALICE);
    assert_eq!(
        version.created_by_agent.as_deref(),
        Some("bot|00000000-0000-0000-0000-00000000a1a1")
    );
}

#[tokio::test]
async fn publish_on_a_stale_base_version_conflicts() {
    let service = service();
    service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Onboarding".to_string(),
                project_id: None,
                files: vec![FileInput {
                    path: "index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: Some(b"<h1>Hi</h1>".to_vec()),
                }],
                scenes: vec![],
                message: None,
            },
        )
        .await
        .unwrap();
    service
        .restore(edit_receipt(), &alice_publishing(), 1)
        .await
        .unwrap();

    let result = service
        .publish(
            edit_receipt(),
            &alice_publishing(),
            PublishVersion {
                files: vec![FileInput {
                    path: "index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: None,
                }],
                scenes: vec![],
                message: None,
                base_version: Some(1),
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(ArtifactError::Conflict {
            base: 1,
            current: 2
        })
    ));
}

#[tokio::test]
async fn an_artifact_created_without_files_publishes_version_one_later() {
    let service = service();

    let artifact = service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Large".to_string(),
                project_id: None,
                files: vec![],
                scenes: vec![],
                message: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(artifact.current, None);

    let before = service
        .view_url(view_receipt(), ViewUrlRequest::default())
        .await;
    assert!(
        matches!(before, Err(ArtifactError::NotFound(message)) if message.contains("no published version"))
    );

    service.object_store.objects.lock().unwrap().insert(
        (DOCUMENT_ID.to_string(), PAGE_SHA.to_string()),
        b"<h1>Hi</h1>".to_vec(),
    );
    let version = service
        .publish(
            edit_receipt(),
            &alice_publishing(),
            PublishVersion {
                files: vec![FileInput {
                    path: "index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: None,
                }],
                scenes: vec![],
                message: None,
                base_version: Some(0),
            },
        )
        .await
        .unwrap();

    assert_eq!(version.number, 1);
    assert_eq!(
        *service.notifier.published.lock().unwrap(),
        vec![(DOCUMENT_ID.to_string(), 1)]
    );
}

#[tokio::test]
async fn uploads_skip_objects_already_stored() {
    let service = service();
    service.object_store.objects.lock().unwrap().insert(
        (DOCUMENT_ID.to_string(), PAGE_SHA.to_string()),
        b"<h1>Hi</h1>".to_vec(),
    );

    let uploads = service
        .uploads(
            edit_receipt(),
            vec![
                UploadInput {
                    sha256: PAGE_SHA.to_string(),
                    size: 11,
                    content_type: "text/html".to_string(),
                },
                UploadInput {
                    sha256: CSS_SHA.to_string(),
                    size: 6,
                    content_type: "text/css".to_string(),
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        uploads,
        vec![UploadTarget {
            sha256: Sha256(CSS_SHA.to_string()),
            url: format!("https://bucket.test/artifacts/{DOCUMENT_ID}/{CSS_SHA}"),
            headers: [("content-type".to_string(), "text/css".to_string())].into(),
        }]
    );
}

#[tokio::test]
async fn view_url_points_at_the_scene_on_the_artifact_origin() {
    let service = service();
    service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Onboarding".to_string(),
                project_id: None,
                files: vec![
                    FileInput {
                        path: "index.html".to_string(),
                        content_type: "text/html".to_string(),
                        sha256: PAGE_SHA.to_string(),
                        content: Some(b"<h1>Hi</h1>".to_vec()),
                    },
                    FileInput {
                        path: "scenes/empty state.html".to_string(),
                        content_type: "text/html".to_string(),
                        sha256: PAGE_SHA.to_string(),
                        content: Some(b"<h1>Hi</h1>".to_vec()),
                    },
                ],
                scenes: vec![SceneInput {
                    id: "empty".to_string(),
                    title: "Empty".to_string(),
                    path: "scenes/empty state.html".to_string(),
                }],
                message: None,
            },
        )
        .await
        .unwrap();

    let view_url = service
        .view_url(
            view_receipt(),
            ViewUrlRequest {
                version: None,
                scene: Some("empty".to_string()),
                theme: Some(Theme::Dark),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        view_url.url,
        format!(
            "https://{DOCUMENT_ID}.artifacts.test/t/token-for-{DOCUMENT_ID}/v/1/scenes/empty%20state.html?theme=dark"
        )
    );
    assert_eq!(
        view_url.origin,
        format!("https://{DOCUMENT_ID}.artifacts.test")
    );
    assert_eq!(view_url.version, 1);

    let missing = service
        .view_url(
            view_receipt(),
            ViewUrlRequest {
                version: None,
                scene: Some("full".to_string()),
                theme: None,
            },
        )
        .await;
    assert!(matches!(missing, Err(ArtifactError::NotFound(_))));
}

#[tokio::test]
async fn load_document_finds_only_artifacts() {
    let service = service();
    service.documents.documents.lock().unwrap().insert(
        "markdown-document".to_string(),
        DocumentBasic {
            document_id: "markdown-document".to_string(),
            document_name: "Notes".to_string(),
            owner: model_owner::Owner::from_principal_str(ALICE).unwrap(),
            file_type: Some("md".to_string()),
            sub_type: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        },
    );

    let result = service.load_document("markdown-document").await;

    assert!(matches!(result, Err(ArtifactError::NotFound(_))));
}

const CANVAS_ID: &str = "0193f3a4-7d1e-7c2a-9f00-00000000ca17";

fn canvas_edit_receipt() -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(ALICE).unwrap(),
        CANVAS_ID,
        EntityType::Document,
    )
}

fn insert_document(service: &TestService, document_id: &str, file_type: &str) {
    service.documents.documents.lock().unwrap().insert(
        document_id.to_string(),
        DocumentBasic {
            document_id: document_id.to_string(),
            document_name: "Board".to_string(),
            owner: model_owner::Owner::from_principal_str(ALICE).unwrap(),
            file_type: Some(file_type.to_string()),
            sub_type: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        },
    );
}

/// An artifact named "Onboarding" whose version 1 has the scene `empty`.
async fn artifact_with_a_scene(service: &TestService) {
    service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Onboarding".to_string(),
                project_id: None,
                files: vec![FileInput {
                    path: "index.html".to_string(),
                    content_type: "text/html".to_string(),
                    sha256: PAGE_SHA.to_string(),
                    content: Some(b"<h1>Hi</h1>".to_vec()),
                }],
                scenes: vec![SceneInput {
                    id: "empty".to_string(),
                    title: "Empty".to_string(),
                    path: "index.html".to_string(),
                }],
                message: None,
            },
        )
        .await
        .unwrap();
}

const ITEM_ID: &str = "0193f3a4-7d1e-7c2a-9f00-0000000001e7";

#[tokio::test]
async fn place_records_the_reference_then_embeds_a_document_node() {
    let service = service();
    artifact_with_a_scene(&service).await;
    let publisher = Publisher {
        user_id: ALICE.to_string(),
        agent: Some("bot-1".to_string()),
    };
    let item_id = uuid::Uuid::parse_str(ITEM_ID).unwrap();
    let mention_id = uuid::Uuid::new_v5(&item_id, CANVAS_REFERENCE_NAMESPACE);

    let placement = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &publisher,
            PlaceArtifact {
                item_id: Some(item_id),
                scene: Some("empty".to_string()),
                x: -40.0,
                y: 120.5,
                width: 640.0,
                height: 480.0,
            },
        )
        .await
        .unwrap();

    assert_eq!(placement, Placement { item_id });
    assert_eq!(
        *service.canvases.references.lock().unwrap(),
        vec![(
            mention_id,
            CANVAS_ID.to_string(),
            DOCUMENT_ID.to_string(),
            ALICE.to_string()
        )]
    );
    assert_eq!(
        *service.canvases.embedded.lock().unwrap(),
        vec![(
            CANVAS_ID.to_string(),
            publisher,
            CanvasDocumentNode {
                item_id,
                document_id: DOCUMENT_ID.to_string(),
                name: "Onboarding".to_string(),
                file_type: "artifact".to_string(),
                subpath: Some("empty".to_string()),
                x: -40.0,
                y: 120.5,
                width: 640.0,
                height: 480.0,
                mention_id,
            }
        )]
    );
}

#[tokio::test]
async fn repeating_a_placement_with_its_item_id_leaves_one_node_and_one_reference() {
    let service = service();
    artifact_with_a_scene(&service).await;
    let item_id = uuid::Uuid::parse_str(ITEM_ID).unwrap();
    let place = || PlaceArtifact {
        item_id: Some(item_id),
        scene: None,
        x: 0.0,
        y: 0.0,
        width: 640.0,
        height: 480.0,
    };

    let first = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(),
        )
        .await
        .unwrap();
    let second = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(),
        )
        .await
        .unwrap();

    assert_eq!(first, second);
    assert_eq!(service.canvases.references.lock().unwrap().len(), 1);
    assert_eq!(service.canvases.embedded.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_placement_without_an_item_id_gets_a_new_one() {
    let service = service();
    artifact_with_a_scene(&service).await;
    let place = || PlaceArtifact {
        item_id: None,
        scene: None,
        x: 0.0,
        y: 0.0,
        width: 640.0,
        height: 480.0,
    };

    let first = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(),
        )
        .await
        .unwrap();
    let second = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(),
        )
        .await
        .unwrap();

    assert_ne!(first.item_id, second.item_id);
    assert_eq!(service.canvases.embedded.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn place_refuses_a_missing_scene_and_bad_geometry_before_recording_anything() {
    let service = service();
    artifact_with_a_scene(&service).await;
    let place = |scene: Option<&str>, width: f64, x: f64| PlaceArtifact {
        item_id: None,
        scene: scene.map(str::to_string),
        x,
        y: 0.0,
        width,
        height: 300.0,
    };

    let missing_scene = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(Some("full"), 400.0, 0.0),
        )
        .await;
    let zero_width = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(None, 0.0, 0.0),
        )
        .await;
    let far_away = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            place(None, 400.0, f64::INFINITY),
        )
        .await;

    assert!(matches!(missing_scene, Err(ArtifactError::NotFound(_))));
    assert!(matches!(zero_width, Err(ArtifactError::BadRequest(_))));
    assert!(matches!(far_away, Err(ArtifactError::BadRequest(_))));
    assert!(service.canvases.references.lock().unwrap().is_empty());
    assert!(service.canvases.embedded.lock().unwrap().is_empty());
}

#[tokio::test]
async fn place_refuses_an_artifact_without_a_version() {
    let service = service();
    service
        .create(
            &alice(),
            &alice_publishing(),
            CreateArtifact {
                name: "Draft".to_string(),
                project_id: None,
                files: vec![],
                scenes: vec![],
                message: None,
            },
        )
        .await
        .unwrap();

    let result = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            PlaceArtifact {
                item_id: None,
                scene: None,
                x: 0.0,
                y: 0.0,
                width: 640.0,
                height: 480.0,
            },
        )
        .await;

    assert!(matches!(result, Err(ArtifactError::NotFound(_))));
    assert!(service.canvases.references.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_refused_embed_keeps_the_reference_for_a_retry() {
    let service = ArtifactServiceImpl::new(
        MemoryRepository::default(),
        MemoryObjectStore::default(),
        MemoryDocuments::new(DOCUMENT_ID),
        FakeTokens::default(),
        RecordingNotifier::default(),
        FakeCanvases {
            refuse_embed: true,
            ..FakeCanvases::default()
        },
        ContentOrigin {
            scheme: "https".to_string(),
            host: "artifacts.test".to_string(),
            port: None,
        },
    );
    artifact_with_a_scene(&service).await;

    let result = service
        .place(
            view_receipt(),
            canvas_edit_receipt(),
            &alice_publishing(),
            PlaceArtifact {
                item_id: None,
                scene: None,
                x: 0.0,
                y: 0.0,
                width: 640.0,
                height: 480.0,
            },
        )
        .await;

    assert!(matches!(result, Err(ArtifactError::BadRequest(_))));
    assert_eq!(service.canvases.references.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn load_canvas_refuses_documents_that_are_not_canvases() {
    let service = service();
    insert_document(&service, CANVAS_ID, "canvas");
    insert_document(&service, "markdown-document", "md");

    assert_eq!(
        service.load_canvas(CANVAS_ID).await.unwrap().document_id,
        CANVAS_ID
    );
    assert!(matches!(
        service.load_canvas("markdown-document").await,
        Err(ArtifactError::BadRequest(_))
    ));
    assert!(matches!(
        service.load_canvas("missing").await,
        Err(ArtifactError::NotFound(_))
    ));
}
