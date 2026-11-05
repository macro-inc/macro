use super::*;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use sha2::Digest as _;
use std::sync::{Arc, Mutex};

/// One request the stand-in egress received.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Received {
    pub(crate) method: Method,
    pub(crate) path: String,
    pub(crate) authorization: Option<String>,
    pub(crate) content_type: Option<String>,
    pub(crate) body: Bytes,
}

impl Received {
    pub(crate) fn json(&self) -> Value {
        serde_json::from_slice(&self.body).expect("a json body")
    }
}

/// A stand-in for the agent egress (and the bucket behind its presigned
/// URLs): records every request and answers each `METHOD path` with the
/// response it was given, in order.
#[derive(Clone)]
pub(crate) struct StandIn {
    pub(crate) received: Arc<Mutex<Vec<Received>>>,
    answers: Arc<Mutex<Vec<(String, StatusCode, Value)>>>,
}

impl StandIn {
    /// Serve on a loopback port; returns the stand-in and its base URL.
    pub(crate) async fn start(answers: Vec<(&str, StatusCode, Value)>) -> (Self, String) {
        let stand_in = Self {
            received: Arc::default(),
            answers: Arc::new(Mutex::new(
                answers
                    .into_iter()
                    .map(|(call, status, body)| (call.to_owned(), status, body))
                    .collect(),
            )),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("address"));
        let app = Router::new()
            .fallback(answer_request)
            .layer(axum::extract::DefaultBodyLimit::disable())
            .with_state(stand_in.clone());
        tokio::spawn(async move { axum::serve(listener, app).await });
        (stand_in, base)
    }

    pub(crate) fn received(&self) -> Vec<Received> {
        self.received.lock().expect("lock").clone()
    }
}

async fn answer_request(
    State(stand_in): State<StandIn>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    stand_in.received.lock().expect("lock").push(Received {
        method: method.clone(),
        path: uri.path().to_owned(),
        authorization: header("authorization"),
        content_type: header("x-amz-content-type").or_else(|| header("content-type")),
        body,
    });
    let call = format!("{method} {}", uri.path());
    let mut answers = stand_in.answers.lock().expect("lock");
    match answers
        .iter()
        .position(|(expected, _, _)| *expected == call)
    {
        Some(index) => {
            let (_, status, body) = answers.remove(index);
            (status, axum::Json(body)).into_response()
        }
        None => (StatusCode::IM_A_TEAPOT, format!("unexpected {call}")).into_response(),
    }
}

fn file(path: &str, content_type: &'static str, bytes: &[u8]) -> LocalFile {
    LocalFile {
        path: path.to_owned(),
        content_type,
        sha256: hex::encode(sha2::Sha256::digest(bytes)),
        bytes: bytes.to_vec(),
    }
}

const ID: &str = "0198a7b2-6c1d-7f00-8000-000000000001";

fn empty_scene() -> Scene {
    Scene {
        id: "empty".to_owned(),
        title: "Empty".to_owned(),
        path: "scenes/empty.html".to_owned(),
    }
}

#[tokio::test]
async fn a_new_artifact_is_created_with_its_files_inline() {
    let (stand_in, base) = StandIn::start(vec![(
        "POST /artifacts",
        StatusCode::CREATED,
        json!({
            "document_id": ID,
            "name": "Agents",
            "owner": "macro|teammate@macro.com",
            "current": {
                "number": 1,
                "files": [],
                "scenes": [{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}],
                "created_by": "macro|teammate@macro.com",
                "created_at": "2026-11-04T00:00:00Z"
            }
        }),
    )])
    .await;
    let egress = Egress::new(&base, "session-token").expect("client");

    let published = egress
        .publish(Publication {
            files: vec![
                file("index.html", "text/html", b"<a href=scenes/empty.html>"),
                file("scenes/empty.html", "text/html", b"<p>none</p>"),
            ],
            artifact_id: None,
            name: Some("Agents".to_owned()),
            scenes: Some(vec![empty_scene()]),
            message: Some("First cut".to_owned()),
            base_version: None,
        })
        .await
        .expect("published");

    assert_eq!(
        published,
        Published {
            artifact_id: ID.to_owned(),
            version: 1,
            scenes: vec![empty_scene()],
            uploaded: 2,
            reused: 0,
        }
    );
    let received = stand_in.received();
    assert_eq!(received.len(), 1);
    assert_eq!(
        received[0].authorization.as_deref(),
        Some("Bearer session-token")
    );
    assert_eq!(
        received[0].json(),
        json!({
            "name": "Agents",
            "files": [
                {
                    "path": "index.html",
                    "content_type": "text/html",
                    "sha256": hex::encode(sha2::Sha256::digest(b"<a href=scenes/empty.html>")),
                    "content_base64": "PGEgaHJlZj1zY2VuZXMvZW1wdHkuaHRtbD4="
                },
                {
                    "path": "scenes/empty.html",
                    "content_type": "text/html",
                    "sha256": hex::encode(sha2::Sha256::digest(b"<p>none</p>")),
                    "content_base64": "PHA+bm9uZTwvcD4="
                }
            ],
            "scenes": [{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}],
            "message": "First cut"
        })
    );
}

/// An update sends only the bytes Macro asks for, to the presigned URL with
/// exactly its headers and no session token, then publishes by hash.
#[tokio::test]
async fn an_update_uploads_only_missing_files_and_publishes_by_hash() {
    let index = file("index.html", "text/html", b"<h1>v2</h1>");
    let theme = file("theme.css", "text/css", b":root{}");
    let (stand_in, base) = StandIn::start(Vec::new()).await;
    let upload_url = format!("{base}/bucket/{}", index.sha256);
    stand_in.answers.lock().expect("lock").extend([
        (
            format!("POST /artifacts/{ID}/uploads"),
            StatusCode::OK,
            json!({"uploads": [{
                "sha256": index.sha256,
                "url": upload_url,
                "headers": {"x-amz-content-type": "text/html"}
            }]}),
        ),
        (
            format!("PUT /bucket/{}", index.sha256),
            StatusCode::OK,
            json!({}),
        ),
        (
            format!("POST /artifacts/{ID}/versions"),
            StatusCode::CREATED,
            json!({
                "number": 3,
                "files": [],
                "scenes": [],
                "created_by": "macro|teammate@macro.com",
                "created_at": "2026-11-04T00:00:00Z"
            }),
        ),
    ]);
    let egress = Egress::new(&base, "session-token").expect("client");

    let published = egress
        .publish(Publication {
            files: vec![index.clone(), theme.clone()],
            artifact_id: Some(ID.to_owned()),
            name: None,
            scenes: Some(Vec::new()),
            message: None,
            base_version: Some(2),
        })
        .await
        .expect("published");

    assert_eq!(published.version, 3);
    assert_eq!((published.uploaded, published.reused), (1, 1));
    let received = stand_in.received();
    assert_eq!(
        received
            .iter()
            .map(|request| format!("{} {}", request.method, request.path))
            .collect::<Vec<_>>(),
        vec![
            format!("POST /artifacts/{ID}/uploads"),
            format!("PUT /bucket/{}", index.sha256),
            format!("POST /artifacts/{ID}/versions"),
        ]
    );
    assert_eq!(
        received[0].json(),
        json!({"files": [
            {"sha256": index.sha256, "size": 11, "content_type": "text/html"},
            {"sha256": theme.sha256, "size": 7, "content_type": "text/css"}
        ]})
    );
    assert_eq!(received[1].authorization, None);
    assert_eq!(received[1].content_type.as_deref(), Some("text/html"));
    assert_eq!(received[1].body, Bytes::from_static(b"<h1>v2</h1>"));
    assert_eq!(
        received[2].json(),
        json!({
            "files": [
                {"path": "index.html", "content_type": "text/html", "sha256": index.sha256},
                {"path": "theme.css", "content_type": "text/css", "sha256": theme.sha256}
            ],
            "scenes": [],
            "base_version": 2
        })
    );
}

#[tokio::test]
async fn an_update_without_scenes_keeps_the_current_ones() {
    let index = file("index.html", "text/html", b"<h1>v2</h1>");
    let (stand_in, base) = StandIn::start(vec![
        (
            &format!("GET /artifacts/{ID}"),
            StatusCode::OK,
            json!({
                "document_id": ID,
                "name": "Agents",
                "owner": "macro|teammate@macro.com",
                "current": {
                    "number": 1,
                    "files": [],
                    "scenes": [{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}],
                    "created_by": "macro|teammate@macro.com",
                    "created_at": "2026-11-04T00:00:00Z"
                }
            }),
        ),
        (
            &format!("POST /artifacts/{ID}/uploads"),
            StatusCode::OK,
            json!({"uploads": []}),
        ),
        (
            &format!("POST /artifacts/{ID}/versions"),
            StatusCode::CREATED,
            json!({
                "number": 2,
                "files": [],
                "scenes": [{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}],
                "created_by": "macro|teammate@macro.com",
                "created_at": "2026-11-04T00:00:00Z"
            }),
        ),
    ])
    .await;
    let egress = Egress::new(&base, "session-token").expect("client");

    let published = egress
        .publish(Publication {
            files: vec![index],
            artifact_id: Some(ID.to_owned()),
            name: None,
            scenes: None,
            message: None,
            base_version: None,
        })
        .await
        .expect("published");

    assert_eq!(published.scenes, vec![empty_scene()]);
    assert_eq!((published.uploaded, published.reused), (0, 1));
    assert_eq!(
        stand_in.received()[2].json()["scenes"],
        json!([{"id": "empty", "title": "Empty", "path": "scenes/empty.html"}])
    );
}

/// Someone published since the version the agent saw: the agent hears the
/// status and Macro's own explanation.
#[tokio::test]
async fn a_conflict_reaches_the_agent_with_macros_explanation() {
    let (_stand_in, base) = StandIn::start(vec![
        (
            &format!("POST /artifacts/{ID}/uploads"),
            StatusCode::OK,
            json!({"uploads": []}),
        ),
        (
            &format!("POST /artifacts/{ID}/versions"),
            StatusCode::CONFLICT,
            json!({"message": "version 4 is current"}),
        ),
    ])
    .await;
    let egress = Egress::new(&base, "session-token").expect("client");

    let refused = egress
        .publish(Publication {
            files: vec![file("index.html", "text/html", b"<h1>v2</h1>")],
            artifact_id: Some(ID.to_owned()),
            name: None,
            scenes: Some(Vec::new()),
            message: None,
            base_version: Some(3),
        })
        .await
        .expect_err("refused");

    assert_eq!(
        refused.to_string(),
        r#"Macro refused publish the version with 409 Conflict: {"message":"version 4 is current"}"#
    );
}

/// A version too big for one request is created without one, uploaded
/// into, and published as version 1.
#[tokio::test]
async fn a_large_new_artifact_is_created_empty_then_published_through_uploads() {
    let index = file("index.html", "text/html", b"<video src=intro.mp4>");
    let video = file("intro.mp4", "video/mp4", &vec![0; 14 * 1024 * 1024]);
    let poster = file("poster.png", "image/png", &vec![1; 7 * 1024 * 1024]);
    let (stand_in, base) = StandIn::start(Vec::new()).await;
    let video_url = format!("{base}/bucket/{}", video.sha256);
    let poster_url = format!("{base}/bucket/{}", poster.sha256);
    stand_in.answers.lock().expect("lock").extend([
        (
            "POST /artifacts".to_owned(),
            StatusCode::CREATED,
            json!({
                "document_id": ID,
                "name": "Intro",
                "owner": "macro|teammate@macro.com",
                "current": null
            }),
        ),
        (
            format!("POST /artifacts/{ID}/uploads"),
            StatusCode::OK,
            json!({"uploads": [
                {"sha256": index.sha256, "url": format!("{base}/bucket/{}", index.sha256), "headers": {}},
                {"sha256": video.sha256, "url": video_url, "headers": {}},
                {"sha256": poster.sha256, "url": poster_url, "headers": {}}
            ]}),
        ),
        (
            format!("PUT /bucket/{}", index.sha256),
            StatusCode::OK,
            json!({}),
        ),
        (
            format!("PUT /bucket/{}", video.sha256),
            StatusCode::OK,
            json!({}),
        ),
        (
            format!("PUT /bucket/{}", poster.sha256),
            StatusCode::OK,
            json!({}),
        ),
        (
            format!("POST /artifacts/{ID}/versions"),
            StatusCode::CREATED,
            json!({
                "number": 1,
                "files": [],
                "scenes": [],
                "created_by": "macro|teammate@macro.com",
                "created_at": "2026-11-04T00:00:00Z"
            }),
        ),
    ]);
    let egress = Egress::new(&base, "session-token").expect("client");

    let published = egress
        .publish(Publication {
            files: vec![index.clone(), video.clone(), poster.clone()],
            artifact_id: None,
            name: Some("Intro".to_owned()),
            scenes: None,
            message: Some("First cut".to_owned()),
            base_version: None,
        })
        .await
        .expect("published");

    assert_eq!(published.version, 1);
    assert_eq!((published.uploaded, published.reused), (3, 0));
    let received = stand_in.received();
    assert_eq!(
        received[0].json(),
        json!({"name": "Intro", "files": [], "scenes": []})
    );
    assert_eq!(received[3].body.len(), 14 * 1024 * 1024);
    assert_eq!(received[4].body.len(), 7 * 1024 * 1024);
    assert_eq!(received[5].json()["base_version"], json!(0));
    assert_eq!(received[5].json()["message"], json!("First cut"));
}
