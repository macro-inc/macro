use super::{ImageSource, rehost_html_images};
use axum::Json;
use axum::Router;
use axum::routing::put;
use bytes::Bytes;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::net::TcpListener;

const PUBLIC_URL: &str = "https://images.example.com/logo.png?size=2&amp;v=1";
const PUBLIC_SOURCE: &str = "https://images.example.com/logo.png?size=2&v=1";
const PRIVATE_SOURCE: &str = "https://mailbox.example.com/image?id=7&v=1";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsignature-logo";

/// Every image loads; one of them only with an account's credentials.
struct Images;

impl ImageSource for Images {
    async fn fetch(&self, _url: &str) -> anyhow::Result<Option<Bytes>> {
        Ok(Some(Bytes::from_static(PNG)))
    }

    fn is_public(&self, url: &str) -> bool {
        url != PRIVATE_SOURCE
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shares_only_copies_of_public_images(db: PgPool) {
    let sfs = FakeSfs::start().await;
    let html = format!(
        r#"<p>Signature</p><img src="{PUBLIC_URL}"><img src="{}">"#,
        PRIVATE_SOURCE.replace('&', "&amp;")
    );

    let (rewritten, unresolved) = rehost_html_images(&db, &sfs.client, &html, &Images)
        .await
        .unwrap();

    assert_eq!(unresolved, 0);
    assert!(!rewritten.contains("images.example.com"), "{rewritten}");
    assert!(!rewritten.contains("mailbox.example.com"), "{rewritten}");
    assert_eq!(sfs.uploads.load(Ordering::SeqCst), 2);
    let shared = email_db_client::sfs_mappings::fetch_sfs_mappings(
        &db,
        &HashSet::from([PUBLIC_SOURCE.to_string(), PRIVATE_SOURCE.to_string()]),
    )
    .await
    .unwrap();
    assert_eq!(
        shared.keys().collect::<Vec<_>>(),
        vec![&PUBLIC_SOURCE.to_string()]
    );
}

/// The static file service's two-step upload: a presigned URL, then the bytes.
struct FakeSfs {
    client: StaticFileServiceClient,
    uploads: Arc<AtomicUsize>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for FakeSfs {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl FakeSfs {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let uploads = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/internal/file",
                put({
                    let origin = origin.clone();
                    let uploads = uploads.clone();
                    move || async move {
                        let n = uploads.fetch_add(1, Ordering::SeqCst);
                        Json(json!({
                            "upload_url": format!("{origin}/blob/{n}"),
                            "file_location": format!("https://static-file-service.example.com/file/{n}"),
                            "id": n.to_string(),
                        }))
                    }
                }),
            )
            .route("/blob/{n}", put(|| async {}));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            client: StaticFileServiceClient::new("key".to_string(), origin),
            uploads,
            server,
        }
    }
}
