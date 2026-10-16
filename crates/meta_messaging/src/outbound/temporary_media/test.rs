use super::*;
use crate::{
    domain::temporary_media::{MediaCopyRepository, TemporaryMedia, TemporaryMediaService},
    outbound::repository::PgMessagingRepository,
};
use axum::{
    Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Default)]
struct Store {
    objects: Mutex<BTreeMap<String, Vec<u8>>>,
    deletes: Mutex<Vec<(String, String)>>,
    fail_delete: AtomicBool,
}
async fn upload(
    State(store): State<Arc<Store>>,
    Path((_bucket, key)): Path<(String, String)>,
    body: Bytes,
) -> impl axum::response::IntoResponse {
    store.objects.lock().unwrap().insert(key, body.to_vec());
    (StatusCode::OK, [("x-amz-version-id", "copy-v1")], "")
}
async fn versions(
    State(store): State<Arc<Store>>,
    Query(query): Query<HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let prefix = query.get("prefix").unwrap();
    let rows=store.objects.lock().unwrap().keys().filter(|key|key.starts_with(prefix))
        .map(|key|format!("<Version><Key>{key}</Key><VersionId>copy-v1</VersionId><IsLatest>true</IsLatest><Size>1</Size></Version>"))
        .collect::<String>();
    (
        [("content-type", "application/xml")],
        format!(
            "<ListVersionsResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><IsTruncated>false</IsTruncated>{rows}</ListVersionsResult>"
        ),
    )
}
async fn remove(
    State(store): State<Arc<Store>>,
    Path((_bucket, key)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    if store.fail_delete.load(Ordering::SeqCst) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "<Error><Code>ServiceUnavailable</Code></Error>",
        );
    }
    let version = query
        .get("versionId")
        .expect("cleanup must physically delete a version, not add a delete marker");
    store
        .deletes
        .lock()
        .unwrap()
        .push((key.clone(), version.clone()));
    store.objects.lock().unwrap().remove(&key);
    (StatusCode::NO_CONTENT, "")
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
        .route("/{bucket}", get(versions))
        .route("/{bucket}/", get(versions))
        .route("/{bucket}/{*key}", put(upload).delete(remove))
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
        Arc::new(S3MediaCopies::new(Client::from_conf(config))),
    )
}
fn file() -> MediaBytes {
    MediaBytes {
        filename: "alice@example.test-invoice.pdf".into(),
        mime_type: "application/pdf".into(),
        bytes: b"%PDF-fixture-private-content".to_vec(),
    }
}
async fn expire(pool: &PgPool, id: Uuid) {
    sqlx::query!("UPDATE meta_messaging_media_copy SET delete_after=now()-interval '1 second',available_at=now()-interval '1 second' WHERE id=$1",id).execute(pool).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opaque_copy_has_a_scoped_url_and_verified_physical_cleanup(pool: PgPool) {
    let (_server, objects, storage) = storage().await;
    let repo = Arc::new(PgMessagingRepository::new(pool.clone()));
    let service =
        TemporaryMediaService::new(repo.clone(), storage, "temporary-fixture".into()).unwrap();
    let original = "macro|alice@example.test/document/version";
    objects
        .objects
        .lock()
        .unwrap()
        .insert(original.into(), b"original".to_vec());
    let url = service.stage(&file()).await.unwrap();
    let parsed = url::Url::parse(&url).unwrap();
    let key = parsed.path().strip_prefix("/temporary-fixture/").unwrap();
    let id = Uuid::parse_str(key.strip_prefix("temp/macro-messaging/").unwrap()).unwrap();
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
    assert_eq!(service.cleanup().await.unwrap().deleted, 0);
    expire(&pool, id).await;
    assert_eq!(service.cleanup().await.unwrap().deleted, 1);
    assert!(!objects.objects.lock().unwrap().contains_key(key));
    assert!(objects.objects.lock().unwrap().contains_key(original));
    assert_eq!(
        *objects.deletes.lock().unwrap(),
        vec![(key.to_owned(), "copy-v1".to_owned())]
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_media_copy")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upload_crashes_and_storage_errors_keep_cleanup_durable_and_fenced(pool: PgPool) {
    let (_server, objects, storage) = storage().await;
    let repo = Arc::new(PgMessagingRepository::new(pool.clone()));
    let service =
        TemporaryMediaService::new(repo.clone(), storage.clone(), "temporary-fixture".into())
            .unwrap();
    // Crash after upload, before a stage caller receives anything: the reservation alone suffices.
    let id = repo.reserve_copy("temporary-fixture").await.unwrap();
    storage
        .put_copy("temporary-fixture", id, &file())
        .await
        .unwrap();
    expire(&pool, id).await;
    let first = repo.claim_copies().await.unwrap().pop().unwrap();
    assert!(repo.claim_copies().await.unwrap().is_empty());
    sqlx::query!(
        "UPDATE meta_messaging_media_copy SET lease_until=now()-interval '1 second' WHERE id=$1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    let second = repo.claim_copies().await.unwrap().pop().unwrap();
    assert!(repo.settle_copy(&first.lease, true).await.is_err());
    repo.settle_copy(&second.lease, false).await.unwrap();
    expire(&pool, id).await;
    objects.fail_delete.store(true, Ordering::SeqCst);
    assert_eq!(service.cleanup().await.unwrap().failed, 1);
    assert!(objects.objects.lock().unwrap().contains_key(&copy_key(id)));
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_media_copy")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    objects.fail_delete.store(false, Ordering::SeqCst);
    expire(&pool, id).await;
    assert_eq!(service.cleanup().await.unwrap().deleted, 1);
}
