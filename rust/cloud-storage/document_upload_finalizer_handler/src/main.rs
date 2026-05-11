#![recursion_limit = "256"]

use std::sync::Arc;

use anyhow::Context as _;
use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use documents::domain::models::DocumentError;
use documents::domain::ports::DocumentRepo;
use documents::domain::upload_finalize::{RepoUploadFinalizePort, UploadedDocumentFinalizer};
use documents::outbound::markdown_init::LexicalSyncMarkdownInitializer;
use documents::outbound::pg_document_repo::PgDocumentRepo;
use lambda_runtime::{Error, LambdaEvent, run, service_fn, tracing};
use lexical_client::LexicalClient;
use model::document::FileType;
use s3_key::DocumentKey;
use sqlx::postgres::PgPoolOptions;
use sync_service_client::SyncServiceClient;

#[derive(Clone)]
struct AppContext {
    document_storage_bucket: String,
    s3_client: aws_sdk_s3::Client,
    repo: PgDocumentRepo,
    lexical_client: LexicalClient,
    sync_service_client: SyncServiceClient,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypointExt::init();

    let document_storage_bucket = std::env::var("DOCUMENT_STORAGE_BUCKET")
        .context("DOCUMENT_STORAGE_BUCKET must be provided")?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;
    let internal_api_secret = std::env::var("INTERNAL_API_SECRET_KEY")
        .context("INTERNAL_API_SECRET_KEY must be provided")?;
    let sync_service_auth_key =
        std::env::var("SYNC_SERVICE_AUTH_KEY").context("SYNC_SERVICE_AUTH_KEY must be provided")?;
    let lexical_service_url =
        std::env::var("LEXICAL_SERVICE_URL").context("LEXICAL_SERVICE_URL must be provided")?;
    let sync_service_url =
        std::env::var("SYNC_SERVICE_URL").context("SYNC_SERVICE_URL must be provided")?;

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let db_pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to postgres")?;

    let context = Arc::new(AppContext {
        document_storage_bucket,
        s3_client: aws_sdk_s3::Client::new(&aws_config),
        repo: PgDocumentRepo::new(db_pool),
        lexical_client: LexicalClient::new(internal_api_secret, lexical_service_url),
        sync_service_client: SyncServiceClient::new(sync_service_auth_key, sync_service_url),
    });

    let func = service_fn(move |event: LambdaEvent<EventBridgeEvent>| {
        let context = context.clone();
        async move { handler(context, event).await }
    });

    run(func).await
}

#[tracing::instrument(skip(context, event), err)]
async fn handler(
    context: Arc<AppContext>,
    event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let detail = &event.payload.detail;

    let bucket = detail
        .get("bucket")
        .and_then(|bucket| bucket.get("name"))
        .and_then(|name| name.as_str())
        .unwrap_or_default();
    let key = detail
        .get("object")
        .and_then(|object| object.get("key"))
        .and_then(|key| key.as_str())
        .unwrap_or_default();

    if key.is_empty() {
        tracing::warn!(?detail, "object-created event did not include object key");
        return Ok(());
    }

    if bucket != context.document_storage_bucket {
        tracing::trace!(%bucket, expected=%context.document_storage_bucket, %key, "skipping event for another bucket");
        return Ok(());
    }

    process_object_created(&context, key).await?;

    Ok(())
}

#[tracing::instrument(skip(context), err)]
async fn process_object_created(context: &AppContext, key: &str) -> Result<(), Error> {
    let document_key = match DocumentKey::from_s3_key(key) {
        Ok(document_key) => document_key,
        Err(error) => {
            tracing::warn!(%key, error=?error, "skipping unparseable document storage key");
            return Ok(());
        }
    };

    if !matches!(document_key, DocumentKey::Versioned { .. }) {
        tracing::trace!(%key, ?document_key, "skipping non-versioned document storage key");
        return Ok(());
    }

    let document_id = document_key.document_id().ok_or_else(|| {
        anyhow::anyhow!("versioned document key did not include a document id: {key}")
    })?;

    let document_context = match context.repo.get_basic_document(document_id).await {
        Ok(document_context) => document_context,
        Err(sqlx::Error::RowNotFound) => {
            tracing::warn!(%document_id, %key, "document storage object exists but document metadata does not");
            return Ok(());
        }
        Err(error) => {
            return Err(anyhow::Error::new(error)
                .context("failed to fetch document basic metadata")
                .into());
        }
    };

    if document_context.deleted_at.is_some() {
        tracing::trace!(%document_id, %key, "skipping deleted document");
        return Ok(());
    }

    let markdown = if matches!(document_context.try_file_type(), Some(FileType::Md)) {
        Some(read_markdown_object(&context.s3_client, &context.document_storage_bucket, key).await?)
    } else {
        None
    };

    let port = RepoUploadFinalizePort::new(context.repo.clone());
    let markdown_initializer =
        LexicalSyncMarkdownInitializer::new(&context.lexical_client, &context.sync_service_client);
    let finalizer = UploadedDocumentFinalizer::new(&port, &markdown_initializer);

    match finalizer
        .finalize_uploaded_document(&document_context, markdown.as_deref())
        .await
    {
        Ok(()) => {
            tracing::info!(%document_id, %key, "finalized document upload");
            Ok(())
        }
        Err(DocumentError::BadRequest(error)) => {
            tracing::warn!(%document_id, %key, %error, "document upload could not be finalized");
            Ok(())
        }
        Err(error) => Err(anyhow::anyhow!(error).into()),
    }
}

async fn read_markdown_object(
    s3_client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
) -> Result<String, Error> {
    let response = s3_client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .with_context(|| format!("failed to read markdown upload from s3://{bucket}/{key}"))?;

    let bytes = response
        .body
        .collect()
        .await
        .context("failed to collect markdown object body")?
        .into_bytes();

    String::from_utf8(bytes.to_vec())
        .with_context(|| format!("markdown upload is not valid utf-8: s3://{bucket}/{key}"))
        .map_err(Into::into)
}

struct MacroEntrypointExt;

impl MacroEntrypointExt {
    fn init() {
        macro_entrypoint::MacroEntrypoint::default().init();
        tracing::trace!("initiating document upload finalizer lambda");
    }
}
