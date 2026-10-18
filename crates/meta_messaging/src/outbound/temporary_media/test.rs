use super::*;
use crate::domain::temporary_media::TemporaryMedia;
use axum::{
    Router,
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    routing::put,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Store {
    objects: Mutex<BTreeMap<String, Vec<u8>>>,
}
async fn upload(
    State(store): State<Arc<Store>>,
    Path((_bucket, key)): Path<(String, String)>,
    body: Bytes,
) -> impl axum::response::IntoResponse {
    store.objects.lock().unwrap().insert(key, body.to_vec());
    (StatusCode::OK, [("x-amz-version-id", "copy-v1")], "")
}
struct Server(tokio::task::JoinHandle<()>);
impl Drop for Server {
    fn drop(&mut self) {
        self.0.abort();
    }
}
async fn storage() -> (Server, Arc<Store>, Arc<S3MediaCopies>) {
    let state = Arc::new(Store::default());
    let app = Router::new()
        .route("/{bucket}/{*key}", put(upload))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = Server(tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap()
    }));
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version_latest()
        .region(aws_sdk_s3::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            "fixture", "fixture", None, None, "test",
        ))
        .endpoint_url(format!("http://{address}"))
        .force_path_style(true)
        .request_checksum_calculation(aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired)
        .build();
    (
        server,
        state,
        Arc::new(
            S3MediaCopies::new(Client::from_conf(config), "temporary-fixture".into()).unwrap(),
        ),
    )
}
fn file() -> MediaBytes {
    MediaBytes {
        filename: "alice@example.test-invoice.pdf".into(),
        mime_type: "application/pdf".into(),
        bytes: b"%PDF-fixture-private-content".to_vec(),
    }
}
#[tokio::test]
async fn opaque_copy_has_an_expiring_scoped_url_and_preserves_private_original() {
    let (_server, objects, service) = storage().await;
    let original = "macro|alice@example.test/document/version";
    objects
        .objects
        .lock()
        .unwrap()
        .insert(original.into(), b"original".to_vec());
    let url = service.stage(&file()).await.unwrap();
    let parsed = url::Url::parse(&url).unwrap();
    let key = parsed.path().strip_prefix("/temporary-fixture/").unwrap();
    let _id = Uuid::parse_str(key.strip_prefix("temp/macro-messaging/").unwrap()).unwrap();
    assert!(!parsed.path().contains("alice"));
    assert!(!parsed.path().contains("invoice"));
    assert_eq!(
        parsed
            .query_pairs()
            .find(|(k, _)| k == "X-Amz-Expires")
            .unwrap()
            .1,
        "900"
    );
    assert_eq!(
        objects.objects.lock().unwrap().get(key),
        Some(&file().bytes)
    );
    assert!(objects.objects.lock().unwrap().contains_key(original));
}
