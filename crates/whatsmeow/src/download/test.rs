// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values come from `testdata/media/vectors.json`, written by
//! `testdata/generator/media` running whatsmeow's Go code: its downloads ran
//! a real `Client.Download`/`DownloadToFile` against local fake hosts, which
//! [`FakeHosts`] replays over plain HTTP.

use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::response::Response;
use serde_json::Value;

use super::*;
use crate::download_to_file::download_to_file;
use crate::mediaconn::MediaConnHost;

pub(crate) fn vectors() -> Value {
    serde_json::from_str(include_str!("../../testdata/media/vectors.json")).unwrap()
}

pub(crate) fn hex_field(value: &Value) -> Option<Vec<u8>> {
    value.as_str().map(|value| hex::decode(value).unwrap())
}

/// The user agent the generator's client sends.
pub(crate) const USER_AGENT: &str = "whatsmeow-rs-test/1.0";

/// One request a fake host received.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Recorded {
    pub(crate) host: usize,
    pub(crate) method: String,
    pub(crate) request_uri: String,
    pub(crate) headers: BTreeMap<String, String>,
    pub(crate) body: Vec<u8>,
}

impl Recorded {
    /// The request as the Go generator recorded it.
    pub(crate) fn from_vector(value: &Value) -> Recorded {
        Recorded {
            host: usize::try_from(value["host"].as_u64().unwrap()).unwrap(),
            method: value["method"].as_str().unwrap().to_owned(),
            request_uri: value["request_uri"].as_str().unwrap().to_owned(),
            headers: value["headers"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(name, value)| (name.clone(), value.as_str().unwrap().to_owned()))
                .collect(),
            body: hex_field(&value["body"]).unwrap_or_default(),
        }
    }
}

/// A scripted answer; a `None` body serves the last upload.
#[derive(Clone, Debug)]
pub(crate) struct Answer {
    pub(crate) status: u16,
    pub(crate) retry_after: Option<String>,
    pub(crate) body: Option<Vec<u8>>,
}

#[derive(Default)]
struct Shared {
    requests: Mutex<Vec<Recorded>>,
    uploaded: Mutex<Vec<u8>>,
    upload_answer: Mutex<String>,
}

struct Host {
    index: usize,
    script: Mutex<VecDeque<Answer>>,
    shared: Arc<Shared>,
}

/// Local media hosts on 127.0.0.1. Each answers from its script, consumed in
/// order with the last answer repeating, like the Go generator's hosts. With
/// no script, a POST is stored and answered with the upload JSON and a GET
/// serves the stored upload.
pub(crate) struct FakeHosts {
    shared: Arc<Shared>,
    pub(crate) media_conn: MediaConn,
}

/// Header names the Go generator recorded.
const RECORDED_HEADERS: [&str; 5] = [
    "Origin",
    "Referer",
    "User-Agent",
    "Companion_user_secret",
    "Content-Length",
];

async fn serve(State(host): State<Arc<Host>>, request: Request) -> Response {
    let method = request.method().to_string();
    let request_uri = request.uri().to_string();
    let headers = RECORDED_HEADERS
        .iter()
        .filter_map(|name| {
            let value = request.headers().get(*name)?.to_str().ok()?;
            Some(((*name).to_owned(), value.to_owned()))
        })
        .collect();
    let body = to_bytes(request.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    host.shared.requests.lock().unwrap().push(Recorded {
        host: host.index,
        method: method.clone(),
        request_uri,
        headers,
        body: body.clone(),
    });

    let answer = {
        let mut script = host.script.lock().unwrap();
        if script.len() > 1 {
            script.pop_front()
        } else {
            script.front().cloned()
        }
    };
    let answer = answer.unwrap_or_else(|| {
        if method == "POST" {
            body.clone_into(&mut host.shared.uploaded.lock().unwrap());
            Answer {
                status: 200,
                retry_after: None,
                body: Some(host.shared.upload_answer.lock().unwrap().clone().into()),
            }
        } else {
            Answer {
                status: 200,
                retry_after: None,
                body: None,
            }
        }
    });
    let body = answer
        .body
        .unwrap_or_else(|| host.shared.uploaded.lock().unwrap().clone());
    let mut response = Response::builder().status(answer.status);
    if let Some(retry_after) = answer.retry_after {
        response = response.header("Retry-After", retry_after);
    }
    response.body(Body::from(body)).unwrap()
}

impl FakeHosts {
    pub(crate) async fn start(scripts: Vec<Vec<Answer>>, auth: &str) -> FakeHosts {
        let shared = Arc::new(Shared::default());
        let mut hosts = Vec::new();
        for (index, script) in scripts.into_iter().enumerate() {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            hosts.push(MediaConnHost {
                hostname: listener.local_addr().unwrap().to_string(),
            });
            let host = Arc::new(Host {
                index,
                script: Mutex::new(script.into()),
                shared: Arc::clone(&shared),
            });
            let router = Router::new().fallback(serve).with_state(host);
            tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        }
        FakeHosts {
            shared,
            media_conn: MediaConn {
                auth: auth.to_owned(),
                auth_ttl: 0,
                ttl: 3600,
                max_buckets: 0,
                fetched_at: Utc::now(),
                hosts,
            },
        }
    }

    /// A media HTTP client that talks plain HTTP to these hosts.
    pub(crate) fn http() -> MediaHttpClient {
        MediaHttpClient {
            scheme: "http".to_owned(),
            host_override: None,
            ..MediaHttpClient::new(reqwest::Client::new(), USER_AGENT.to_owned(), false)
        }
    }

    pub(crate) fn set_uploaded(&self, body: Vec<u8>) {
        *self.shared.uploaded.lock().unwrap() = body;
    }

    pub(crate) fn set_upload_answer(&self, answer: &str) {
        answer.clone_into(&mut self.shared.upload_answer.lock().unwrap());
    }

    pub(crate) fn take_requests(&self) -> Vec<Recorded> {
        std::mem::take(&mut self.shared.requests.lock().unwrap())
    }
}

#[test]
fn media_keys_match_go() {
    let vectors = vectors();
    let media_types = [
        MediaType::Image,
        MediaType::Video,
        MediaType::Audio,
        MediaType::Document,
        MediaType::History,
        MediaType::AppState,
        MediaType::StickerPack,
        MediaType::LinkThumbnail,
    ];
    let cases = vectors["media_keys"].as_array().unwrap();
    assert_eq!(cases.len(), media_types.len());
    for (media_type, case) in media_types.into_iter().zip(cases) {
        assert_eq!(media_type.app_info(), case["media_type"].as_str().unwrap());
        assert_eq!(media_type.to_string(), media_type.app_info());
        assert_eq!(media_type.mms_type(), case["mms_type"].as_str().unwrap());
        let keys = get_media_keys(&hex_field(&case["media_key"]).unwrap(), Some(media_type));
        assert_eq!(keys.iv.to_vec(), hex_field(&case["iv"]).unwrap());
        assert_eq!(
            keys.cipher_key.to_vec(),
            hex_field(&case["cipher_key"]).unwrap()
        );
        assert_eq!(keys.mac_key.to_vec(), hex_field(&case["mac_key"]).unwrap());
        assert_eq!(keys.ref_key.to_vec(), hex_field(&case["ref_key"]).unwrap());
    }
}

#[test]
fn validate_media_matches_go() {
    for case in vectors()["validate"].as_array().unwrap() {
        let result = validate_media(
            &hex_field(&case["iv"]).unwrap(),
            &hex_field(&case["file"]).unwrap(),
            &hex_field(&case["mac_key"]).unwrap(),
            &hex_field(&case["mac"]).unwrap(),
        );
        let error = result
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert_eq!(error, case["error"].as_str().unwrap());
    }
}

#[test]
fn media_types_of_messages() {
    let image = ImageMessage::default();
    let sticker = StickerMessage::default();
    let history = HistorySyncNotification::default();
    let blob = ExternalBlobReference::default();
    let pack = StickerPackMessage::default();
    assert_eq!(get_media_type(&image), MediaType::Image);
    assert_eq!(get_media_type(&sticker), MediaType::Image);
    assert_eq!(get_media_type(&history), MediaType::History);
    assert_eq!(get_media_type(&blob), MediaType::AppState);
    assert_eq!(get_media_type(&pack), MediaType::StickerPack);
    assert_eq!(
        ExtendedTextMessage::default().get_thumbnail_media_type(),
        MediaType::LinkThumbnail
    );
}

#[test]
fn download_url_matches_go() {
    let vectors = vectors();
    let upload = &vectors["upload"];
    let download = &vectors["downloads"][0];
    let url = MediaHttpClient::new(reqwest::Client::new(), String::new(), false)
        .media_download_url(
            "mmg.whatsapp.net",
            download["direct_path"].as_str().unwrap(),
            hex_field(&upload["file_enc_sha256"]).as_deref(),
            "image",
        );
    assert_eq!(
        url,
        format!(
            "https://mmg.whatsapp.net{}",
            download["requests"][0]["request_uri"].as_str().unwrap()
        )
    );
}

#[test]
fn retry_after_like_go() {
    let fallback = Duration::from_secs(3);
    assert_eq!(retry_after_parse("", fallback), fallback);
    assert_eq!(retry_after_parse("invalid", fallback), fallback);
    assert_eq!(retry_after_parse("12", fallback), Duration::from_secs(12));
    assert_eq!(retry_after_parse("-12", fallback), Duration::ZERO);
    assert_eq!(
        retry_after_parse("Mon, 02 Jan 2006 15:04:05 GMT", fallback),
        Duration::ZERO
    );
    let later = (Utc::now() + chrono::TimeDelta::hours(5))
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    let parsed = retry_after_parse(&later, fallback);
    assert!(parsed > Duration::from_secs(4 * 3600) && parsed <= Duration::from_secs(5 * 3600));
}

/// A minimal in-memory [`crate::download_to_file::File`].
#[derive(Default)]
struct MemoryFile(std::io::Cursor<Vec<u8>>);

impl Read for MemoryFile {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.0.read(buffer)
    }
}

impl io::Write for MemoryFile {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.0.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Seek for MemoryFile {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.0.seek(position)
    }
}

impl cbcutil::File for MemoryFile {
    fn truncate(&mut self, size: u64) -> io::Result<()> {
        self.0.get_mut().truncate(usize::try_from(size).unwrap());
        Ok(())
    }

    fn size(&self) -> io::Result<u64> {
        Ok(self.0.get_ref().len() as u64)
    }
}

#[tokio::test]
async fn downloads_match_go() {
    let vectors = vectors();
    let uploaded = hex_field(&vectors["upload"]["requests"][0]["body"]).unwrap();
    let auth = vectors["auth"].as_str().unwrap();
    for case in vectors["downloads"].as_array().unwrap() {
        let name = format!(
            "{} (to file: {})",
            case["name"].as_str().unwrap(),
            case["to_file"]
        );
        let scripts = case["responses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|script| {
                script
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|answer| Answer {
                        status: u16::try_from(answer["status"].as_u64().unwrap()).unwrap(),
                        retry_after: answer["retry_after"].as_str().map(str::to_owned),
                        body: hex_field(&answer["body"]),
                    })
                    .collect()
            })
            .collect();
        let hosts = FakeHosts::start(scripts, auth).await;
        hosts.set_uploaded(uploaded.clone());
        let message = ImageMessage {
            direct_path: case["direct_path"].as_str().map(str::to_owned),
            media_key: hex_field(&case["media_key"]),
            file_sha256: hex_field(&case["file_sha256"]),
            file_enc_sha256: hex_field(&case["file_enc_sha256"]),
            ..ImageMessage::default()
        };

        let result = if case["to_file"].as_bool().unwrap() {
            let mut file = MemoryFile::default();
            download_to_file(&FakeHosts::http(), &hosts.media_conn, &message, &mut file)
                .await
                .map(|()| file.0.into_inner())
        } else {
            download(&FakeHosts::http(), &hosts.media_conn, &message).await
        };

        match result {
            Ok(data) => {
                assert_eq!(case["error"], "", "{name}");
                assert_eq!(Some(data), hex_field(&case["data"]), "{name}");
            }
            Err(error) => assert_eq!(error.to_string(), case["error"], "{name}"),
        }
        let expected: Vec<Recorded> = case["requests"]
            .as_array()
            .map(|requests| requests.iter().map(Recorded::from_vector).collect())
            .unwrap_or_default();
        assert_eq!(hosts.take_requests(), expected, "{name}");
    }
}

#[tokio::test]
async fn not_found_is_the_404_error() {
    let not_found = Answer {
        status: 404,
        retry_after: None,
        body: Some(Vec::new()),
    };
    let hosts = FakeHosts::start(vec![vec![not_found.clone()], vec![not_found]], "auth").await;
    let message = ImageMessage {
        direct_path: Some("/v/missing?ccb=1".to_owned()),
        media_key: Some(vec![1; 32]),
        file_enc_sha256: Some(vec![2; 32]),
        file_sha256: Some(vec![3; 32]),
        ..ImageMessage::default()
    };
    let error = download(&FakeHosts::http(), &hosts.media_conn, &message)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        DownloadError::Http {
            status_code: 404,
            ..
        }
    ));
    assert!(error.is_http_status(404));
    assert_eq!(hosts.take_requests().len(), 1);
}

#[tokio::test]
async fn download_errors_before_any_request() {
    let hosts = FakeHosts::start(Vec::new(), "auth").await;
    let http = FakeHosts::http();
    let no_path = ImageMessage::default();
    assert!(matches!(
        download(&http, &hosts.media_conn, &no_path).await,
        Err(DownloadError::NoUrlPresent)
    ));
    #[expect(deprecated, reason = "download_any is ported as deprecated, as in Go")]
    let nothing = download_any(&http, &hosts.media_conn, Some(&Message::default())).await;
    assert!(matches!(
        nothing,
        Err(DownloadError::NothingDownloadableFound)
    ));
    // No hosts: Go returns no data and no error.
    let message = ImageMessage {
        direct_path: Some("/v/x".to_owned()),
        ..ImageMessage::default()
    };
    assert_eq!(
        download(&http, &hosts.media_conn, &message).await.unwrap(),
        Vec::<u8>::new()
    );
}
