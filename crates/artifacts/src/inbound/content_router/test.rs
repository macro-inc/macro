use std::collections::BTreeMap;

use axum::http::Request;
use http_body_util::BodyExt;

use super::*;
use crate::domain::models::{
    ArtifactPath, ArtifactVersion, Manifest, Scene, SceneId, Sha256, StoredFile,
};
use crate::domain::service::ArtifactServiceImpl;
use crate::testing::{
    FakeCanvases, FakeTokens, MemoryDocuments, MemoryObjectStore, MemoryRepository,
    RecordingNotifier,
};

const DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-5a1b2c3d4e5f";
const OTHER_DOCUMENT_ID: &str = "0193f3a4-7d1e-7c2a-9f00-000000000002";
const PAGE_SHA: &str = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";
const SCENE_SHA: &str = "12e931809c117b92d600e65c55051bc2286c7c9e4bcee9ecce82e52b7d86cfb9";
const EXPECTED_POLICY: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors https://macro.com tauri://localhost";

/// A content router over one artifact with version 1: `index.html` and a
/// scene page.
fn router() -> Router {
    let repository = MemoryRepository::default();
    repository.versions.lock().unwrap().insert(
        DOCUMENT_ID.to_string(),
        vec![ArtifactVersion {
            number: 1,
            manifest: Manifest {
                files: BTreeMap::from([
                    (
                        ArtifactPath("index.html".to_string()),
                        StoredFile {
                            sha256: Sha256(PAGE_SHA.to_string()),
                            size: 11,
                            content_type: "text/html".to_string(),
                        },
                    ),
                    (
                        ArtifactPath("scenes/empty state.html".to_string()),
                        StoredFile {
                            sha256: Sha256(SCENE_SHA.to_string()),
                            size: 12,
                            content_type: "text/html".to_string(),
                        },
                    ),
                ]),
                scenes: vec![Scene {
                    id: SceneId("empty".to_string()),
                    title: "Empty".to_string(),
                    path: ArtifactPath("scenes/empty state.html".to_string()),
                }],
            },
            message: None,
            created_by: "macro|alice@artifacts.test".to_string(),
            created_by_agent: None,
            created_at: "2026-11-04T12:00:00Z".parse().unwrap(),
        }],
    );

    let object_store = MemoryObjectStore::default();
    object_store.objects.lock().unwrap().extend([
        (
            (DOCUMENT_ID.to_string(), PAGE_SHA.to_string()),
            b"<h1>Hi</h1>".to_vec(),
        ),
        (
            (DOCUMENT_ID.to_string(), SCENE_SHA.to_string()),
            b"<p>Empty</p>".to_vec(),
        ),
    ]);

    let origin = ContentOrigin {
        scheme: "http".to_string(),
        host: "artifacts.localhost".to_string(),
        port: Some(8086),
    };
    let service = ArtifactServiceImpl::new(
        repository,
        object_store,
        MemoryDocuments::new(DOCUMENT_ID),
        FakeTokens::default(),
        RecordingNotifier::default(),
        FakeCanvases::default(),
        origin.clone(),
    );

    content_router(ContentRouterState::new(
        Arc::new(service),
        origin,
        ContentHeaders::new(&[
            "https://macro.com".to_string(),
            "tauri://localhost".to_string(),
        ])
        .unwrap(),
    ))
}

fn header<'a>(response: &'a Response, name: &str) -> Option<&'a str> {
    response
        .headers()
        .get(name)
        .map(|value| value.to_str().unwrap())
}

#[tokio::test]
async fn serves_index_html_with_the_isolation_headers() {
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{DOCUMENT_ID}/v/1/"))
                .header("host", format!("{DOCUMENT_ID}.artifacts.localhost:8086"))
                .header("sec-fetch-dest", "iframe")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(&response, "content-type"), Some("text/html"));
    assert_eq!(header(&response, "content-length"), Some("11"));
    assert_eq!(
        header(&response, "content-security-policy"),
        Some(EXPECTED_POLICY)
    );
    assert_eq!(header(&response, "x-content-type-options"), Some("nosniff"));
    assert_eq!(header(&response, "referrer-policy"), Some("no-referrer"));
    assert_eq!(
        header(&response, "cross-origin-resource-policy"),
        Some("same-origin")
    );
    assert_eq!(
        header(&response, "cache-control"),
        Some("private, max-age=31536000, immutable")
    );
    assert_eq!(header(&response, "set-cookie"), None);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), b"<h1>Hi</h1>");
}

#[tokio::test]
async fn serves_a_scene_page_by_its_encoded_path() {
    let response = router()
        .oneshot(
            Request::get(format!(
                "/t/token-for-{DOCUMENT_ID}/v/1/scenes/empty%20state.html"
            ))
            .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), b"<p>Empty</p>");
}

#[tokio::test]
async fn answers_a_matching_entity_tag_with_not_modified() {
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{DOCUMENT_ID}/v/1/index.html"))
                .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
                .header("if-none-match", format!("\"{PAGE_SHA}\""))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        header(&response, "content-security-policy"),
        Some(EXPECTED_POLICY)
    );
}

#[tokio::test]
async fn refuses_top_level_navigation() {
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{DOCUMENT_ID}/v/1/"))
                .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
                .header("sec-fetch-dest", "document")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(header(&response, "cache-control"), Some("no-store"));
    assert_eq!(
        header(&response, "content-security-policy"),
        Some(EXPECTED_POLICY)
    );
}

#[tokio::test]
async fn refuses_a_token_for_another_artifact() {
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{OTHER_DOCUMENT_ID}/v/1/"))
                .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // The token's own artifact has no such version either way: the host
    // decides which artifact is served.
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{DOCUMENT_ID}/v/1/"))
                .header("host", format!("{OTHER_DOCUMENT_ID}.artifacts.localhost"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn refuses_an_invalid_token() {
    let response = router()
        .oneshot(
            Request::get("/t/forged/v/1/")
                .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unknown_paths_and_versions_are_not_found() {
    for path in [
        format!("/t/token-for-{DOCUMENT_ID}/v/1/missing.html"),
        format!("/t/token-for-{DOCUMENT_ID}/v/2/"),
        format!("/t/token-for-{DOCUMENT_ID}/v/one/"),
        "/index.html".to_string(),
    ] {
        let response = router()
            .oneshot(
                Request::get(&path)
                    .header("host", format!("{DOCUMENT_ID}.artifacts.localhost"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn the_bare_content_host_names_no_artifact() {
    let response = router()
        .oneshot(
            Request::get(format!("/t/token-for-{DOCUMENT_ID}/v/1/"))
                .header("host", "artifacts.localhost:8086")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn dispatch_sends_only_artifact_hosts_to_the_content_router() {
    let origin = ContentOrigin {
        scheme: "http".to_string(),
        host: "artifacts.localhost".to_string(),
        port: Some(8086),
    };
    let api = Router::new().fallback(|| async { "api" });
    let content = Router::new().fallback(|| async { "content" });
    let app = dispatch_by_host(api, content, origin);

    for (host, expected) in [
        ("localhost:8086", "api"),
        ("dev-gateway.macro.com", "api"),
        ("evilartifacts.localhost", "api"),
        ("artifacts.localhost:8086", "content"),
        (
            "0193F3A4-7D1E-7C2A-9F00-5A1B2C3D4E5F.ARTIFACTS.LOCALHOST",
            "content",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get("/documents")
                    .header("host", host)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(body.as_ref(), expected.as_bytes(), "{host}");
    }
}

#[test]
fn recorded_paths_never_carry_the_view_token() {
    assert_eq!(
        redact_path("/t/eyJhbGciOiJIUzI1NiJ9.e30.signature/v/1/scenes/empty%20state.html"),
        "/t/<redacted>/v/1/scenes/empty%20state.html"
    );
    assert_eq!(
        redact_path("/t/eyJhbGciOiJIUzI1NiJ9.e30.signature/v/1/"),
        "/t/<redacted>/v/1/"
    );
    assert_eq!(
        redact_path("/t/eyJhbGciOiJIUzI1NiJ9.e30.signature"),
        "/t/<redacted>"
    );
    assert_eq!(redact_path("/favicon.ico"), "/favicon.ico");
}
