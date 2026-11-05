use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::{FileInput, SceneInput, Theme};
use crate::testing::{FakeTokens, MemoryDocuments, MemoryObjectStore, MemoryRepository};

const DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f";
const ALICE: &str = "macro|alice@artifacts.test";
const PAGE_SHA: &str = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";
const CSS_SHA: &str = "7c98040a541657584690ae2a1cc3b42a8b53b159cc60c5d3abbfecbaeac6c94a";

type TestService =
    ArtifactServiceImpl<MemoryRepository, MemoryObjectStore, MemoryDocuments, FakeTokens>;

fn service() -> TestService {
    ArtifactServiceImpl::new(
        MemoryRepository::default(),
        MemoryObjectStore::default(),
        MemoryDocuments::new(DOCUMENT_ID),
        FakeTokens::default(),
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
    assert_eq!(artifact.current.number, 1);
    assert_eq!(artifact.current.message, None);
    assert_eq!(artifact.current.created_by, ALICE);
    assert_eq!(artifact.current.created_by_agent, None);
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

    let agent = CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: MacroUserIdStr::parse_from_str(ALICE).unwrap(),
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
    service.restore(edit_receipt(), &alice(), 1).await.unwrap();

    let result = service
        .publish(
            edit_receipt(),
            &alice(),
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
async fn a_team_bot_without_a_user_cannot_publish() {
    let service = service();
    let team_bot = CreationPrincipal::TeamBot {
        bot: bot_id::NonSystemBotId::new(bot_id::BotId::new_from_uuid(uuid::Uuid::from_u128(7)))
            .unwrap(),
        team: uuid::Uuid::from_u128(8),
    };

    let result = service
        .create(
            &team_bot,
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
        .await;

    assert!(matches!(result, Err(ArtifactError::Forbidden(_))));
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
            &Viewer::default(),
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
            &Viewer::default(),
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
