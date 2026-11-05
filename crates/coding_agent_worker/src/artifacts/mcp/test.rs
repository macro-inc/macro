use super::*;
use crate::artifacts::publish::test::StandIn;
use axum::http::StatusCode;
use serde_json::json;

const ID: &str = "0198a7b2-6c1d-7f00-8000-000000000001";

/// The tool reads the files from disk itself and answers with links into
/// Macro, never with the files' contents.
#[tokio::test]
async fn publishing_a_directory_answers_with_the_artifacts_links() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let dist = workspace.path().join("dist");
    std::fs::create_dir_all(dist.join("scenes")).expect("mkdir");
    std::fs::write(dist.join("index.html"), "<h1>Agents</h1>").expect("write");
    std::fs::write(dist.join("scenes/empty.html"), "<p>none</p>").expect("write");
    let (stand_in, base) = StandIn::start(vec![(
        "POST /artifacts",
        StatusCode::CREATED,
        json!({
            "document_id": ID,
            "name": "Agents",
            "owner": "macro|operator@macro.com",
            "current": {
                "number": 1,
                "files": [],
                "scenes": [{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}],
                "created_by": "macro|operator@macro.com",
                "created_at": "2026-11-04T00:00:00Z"
            }
        }),
    )])
    .await;
    let server = ArtifactServer::new(
        workspace.path().to_owned(),
        Egress::new(&base, "session-token").expect("client"),
        "https://macro.com/app".to_owned(),
    );

    let answer = server
        .publish(PublishArtifact {
            dir: Some("dist".to_owned()),
            paths: None,
            artifact_id: None,
            name: Some("Agents".to_owned()),
            scenes: Some(vec![Scene {
                id: "empty".to_owned(),
                title: "Empty".to_owned(),
                path: "scenes/empty.html".to_owned(),
            }]),
            message: None,
            base_version: None,
        })
        .await
        .expect("published");

    assert_eq!(
        answer,
        json!({
            "artifact_id": ID,
            "version": 1,
            "web_url": format!("https://macro.com/app/artifact/{ID}"),
            "scene_urls": {"empty": format!("https://macro.com/app/artifact/{ID}?scene=empty")},
            "uploaded_files": 2,
            "reused_files": 0
        })
    );
    let paths = stand_in.received()[0].json()["files"]
        .as_array()
        .expect("files")
        .iter()
        .map(|file| file["path"].clone())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec![json!("index.html"), json!("scenes/empty.html")]);
}

#[tokio::test]
async fn a_path_out_of_the_workspace_is_answered_without_calling_macro() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let (stand_in, base) = StandIn::start(Vec::new()).await;
    let server = ArtifactServer::new(
        workspace.path().to_owned(),
        Egress::new(&base, "session-token").expect("client"),
        "https://macro.com/app".to_owned(),
    );

    let refused = server
        .publish(PublishArtifact {
            dir: Some("..".to_owned()),
            paths: None,
            artifact_id: None,
            name: Some("Escape".to_owned()),
            scenes: None,
            message: None,
            base_version: None,
        })
        .await
        .expect_err("refused");

    assert_eq!(refused, ".. is outside the workspace");
    assert!(stand_in.received().is_empty());
}
