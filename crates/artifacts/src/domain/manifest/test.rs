use std::collections::HashMap;

use super::*;

const PAGE_SHA: &str = "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8";
const CSS_SHA: &str = "7c98040a541657584690ae2a1cc3b42a8b53b159cc60c5d3abbfecbaeac6c94a";
const EMPTY_SCENE_SHA: &str = "12e931809c117b92d600e65c55051bc2286c7c9e4bcee9ecce82e52b7d86cfb9";

#[test]
fn accepts_relative_nested_paths() {
    assert_eq!(parse_path("index.html").unwrap().as_str(), "index.html");
    assert_eq!(
        parse_path("scenes/empty state.html").unwrap().as_str(),
        "scenes/empty state.html"
    );
}

#[test]
fn rejects_unsafe_paths() {
    for path in [
        "",
        "/index.html",
        "../index.html",
        "scenes/../index.html",
        "./index.html",
        "scenes//empty.html",
        "scenes/",
        "scenes\\empty.html",
        "scenes/\nempty.html",
    ] {
        assert!(
            matches!(parse_path(path), Err(ArtifactError::BadRequest(_))),
            "{path:?} should be rejected"
        );
    }
    assert!(parse_path(&"a".repeat(512)).is_ok());
    assert!(parse_path(&"a".repeat(513)).is_err());
}

#[test]
fn scene_ids_are_slugs() {
    assert!(parse_scene_id("empty-state").is_ok());
    assert!(parse_scene_id("0").is_ok());
    assert!(parse_scene_id(&format!("a{}", "b".repeat(63))).is_ok());
    for id in ["", "-empty", "Empty", "empty_state", "empty state"] {
        assert!(parse_scene_id(id).is_err(), "{id:?} should be rejected");
    }
    assert!(parse_scene_id(&format!("a{}", "b".repeat(64))).is_err());
}

#[test]
fn content_types_come_from_the_allowlist() {
    assert_eq!(parse_content_type("Text/HTML").unwrap(), "text/html");
    assert!(parse_content_type("application/x-msdownload").is_err());
    assert!(parse_content_type("text/html; charset=utf-8").is_err());
}

#[test]
fn parses_a_bundle_with_a_scene_and_a_stored_file() {
    let draft = ManifestDraft::parse(
        vec![
            FileInput {
                path: "index.html".to_string(),
                content_type: "text/html".to_string(),
                sha256: PAGE_SHA.to_uppercase(),
                content: Some(b"<h1>Hi</h1>".to_vec()),
            },
            FileInput {
                path: "theme.css".to_string(),
                content_type: "text/css".to_string(),
                sha256: CSS_SHA.to_string(),
                content: None,
            },
            FileInput {
                path: "scenes/empty.html".to_string(),
                content_type: "text/html".to_string(),
                sha256: EMPTY_SCENE_SHA.to_string(),
                content: Some(b"<p>Empty</p>".to_vec()),
            },
        ],
        vec![SceneInput {
            id: "empty-state".to_string(),
            title: " Empty state ".to_string(),
            path: "scenes/empty.html".to_string(),
        }],
    )
    .unwrap();

    assert_eq!(
        draft.stored_digests(),
        HashSet::from([Sha256(CSS_SHA.to_string())])
    );

    let (manifest, inline) = draft
        .finish(&HashMap::from([(Sha256(CSS_SHA.to_string()), 6)]))
        .unwrap();

    assert_eq!(manifest.total_size(), 11 + 6 + 12);
    assert_eq!(
        manifest.files.get(&ArtifactPath("theme.css".to_string())),
        Some(&StoredFile {
            sha256: Sha256(CSS_SHA.to_string()),
            size: 6,
            content_type: "text/css".to_string(),
        })
    );
    assert_eq!(
        manifest.scenes,
        vec![Scene {
            id: SceneId("empty-state".to_string()),
            title: "Empty state".to_string(),
            path: ArtifactPath("scenes/empty.html".to_string()),
        }]
    );
    assert_eq!(
        inline,
        vec![
            InlineObject {
                sha256: Sha256(PAGE_SHA.to_string()),
                content_type: "text/html".to_string(),
                bytes: b"<h1>Hi</h1>".to_vec(),
            },
            InlineObject {
                sha256: Sha256(EMPTY_SCENE_SHA.to_string()),
                content_type: "text/html".to_string(),
                bytes: b"<p>Empty</p>".to_vec(),
            },
        ]
    );
}

#[test]
fn requires_index_html() {
    let result = ManifestDraft::parse(
        vec![FileInput {
            path: "main.html".to_string(),
            content_type: "text/html".to_string(),
            sha256: PAGE_SHA.to_string(),
            content: Some(b"<h1>Hi</h1>".to_vec()),
        }],
        vec![],
    );
    assert!(
        matches!(result, Err(ArtifactError::BadRequest(message)) if message.contains("index.html"))
    );
}

#[test]
fn rejects_content_that_does_not_match_its_sha256() {
    let result = ManifestDraft::parse(
        vec![FileInput {
            path: "index.html".to_string(),
            content_type: "text/html".to_string(),
            sha256: CSS_SHA.to_string(),
            content: Some(b"<h1>Hi</h1>".to_vec()),
        }],
        vec![],
    );
    assert!(
        matches!(result, Err(ArtifactError::BadRequest(message)) if message.contains("does not match"))
    );
}

#[test]
fn rejects_duplicate_paths() {
    let result = ManifestDraft::parse(
        vec![
            FileInput {
                path: "index.html".to_string(),
                content_type: "text/html".to_string(),
                sha256: PAGE_SHA.to_string(),
                content: Some(b"<h1>Hi</h1>".to_vec()),
            },
            FileInput {
                path: "index.html".to_string(),
                content_type: "text/html".to_string(),
                sha256: PAGE_SHA.to_string(),
                content: None,
            },
        ],
        vec![],
    );
    assert!(matches!(result, Err(ArtifactError::BadRequest(message)) if message.contains("twice")));
}

#[test]
fn rejects_more_than_255_files() {
    let files = (0..256)
        .map(|index| FileInput {
            path: if index == 0 {
                "index.html".to_string()
            } else {
                format!("page-{index}.html")
            },
            content_type: "text/html".to_string(),
            sha256: PAGE_SHA.to_string(),
            content: None,
        })
        .collect();
    let result = ManifestDraft::parse(files, vec![]);
    assert!(matches!(result, Err(ArtifactError::BadRequest(message)) if message.contains("255")));
}

#[test]
fn rejects_scenes_that_are_not_files_or_repeat() {
    let index = FileInput {
        path: "index.html".to_string(),
        content_type: "text/html".to_string(),
        sha256: PAGE_SHA.to_string(),
        content: Some(b"<h1>Hi</h1>".to_vec()),
    };

    let missing = ManifestDraft::parse(
        vec![index.clone()],
        vec![SceneInput {
            id: "empty".to_string(),
            title: "Empty".to_string(),
            path: "scenes/empty.html".to_string(),
        }],
    );
    assert!(
        matches!(missing, Err(ArtifactError::BadRequest(message)) if message.contains("not one of the files"))
    );

    let repeated = ManifestDraft::parse(
        vec![index.clone()],
        vec![
            SceneInput {
                id: "home".to_string(),
                title: "Home".to_string(),
                path: "index.html".to_string(),
            },
            SceneInput {
                id: "home".to_string(),
                title: "Home again".to_string(),
                path: "index.html".to_string(),
            },
        ],
    );
    assert!(
        matches!(repeated, Err(ArtifactError::BadRequest(message)) if message.contains("twice"))
    );

    let untitled = ManifestDraft::parse(
        vec![index],
        vec![SceneInput {
            id: "home".to_string(),
            title: "  ".to_string(),
            path: "index.html".to_string(),
        }],
    );
    assert!(
        matches!(untitled, Err(ArtifactError::BadRequest(message)) if message.contains("title"))
    );
}

#[test]
fn a_file_without_content_must_be_stored() {
    let draft = ManifestDraft::parse(
        vec![FileInput {
            path: "index.html".to_string(),
            content_type: "text/html".to_string(),
            sha256: PAGE_SHA.to_string(),
            content: None,
        }],
        vec![],
    )
    .unwrap();
    let result = draft.finish(&HashMap::new());
    assert!(
        matches!(result, Err(ArtifactError::BadRequest(message)) if message.contains("not stored"))
    );
}

#[test]
fn enforces_file_and_version_size_limits() {
    let one_file = ManifestDraft::parse(
        vec![FileInput {
            path: "index.html".to_string(),
            content_type: "text/html".to_string(),
            sha256: PAGE_SHA.to_string(),
            content: None,
        }],
        vec![],
    )
    .unwrap();
    let too_big = one_file.finish(&HashMap::from([(
        Sha256(PAGE_SHA.to_string()),
        16 * 1024 * 1024 + 1,
    )]));
    assert!(
        matches!(too_big, Err(ArtifactError::BadRequest(message)) if message.contains("16 MiB"))
    );

    // Five 16 MiB files: each fits, together they pass 64 MiB.
    let five_files = ManifestDraft::parse(
        (0..5)
            .map(|index| FileInput {
                path: if index == 0 {
                    "index.html".to_string()
                } else {
                    format!("video-{index}.mp4")
                },
                content_type: if index == 0 { "text/html" } else { "video/mp4" }.to_string(),
                sha256: PAGE_SHA.to_string(),
                content: None,
            })
            .collect(),
        vec![],
    )
    .unwrap();
    let over_version = five_files.finish(&HashMap::from([(
        Sha256(PAGE_SHA.to_string()),
        16 * 1024 * 1024,
    )]));
    assert!(
        matches!(over_version, Err(ArtifactError::BadRequest(message)) if message.contains("64 MiB"))
    );
}
