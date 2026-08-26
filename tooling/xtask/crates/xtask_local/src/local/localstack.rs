//! Idempotent LocalStack provisioning (S3 / SQS / DynamoDB / KMS), replacing the
//! `tooling/just/local_stack.just` recipes. Uses the AWS SDK (the dev shell ships no `aws`
//! CLI) and runs the three independent resource groups concurrently.

use anyhow::{Context, Result};
use aws_sdk_dynamodb::types as ddb_types;
use aws_sdk_s3::types as s3_types;

use super::instance::{Instance, Port};
use super::resources;

/// Provision all LocalStack resources idempotently. Blocking entry point: spins
/// up a Tokio runtime so the orchestrator stays synchronous.
pub fn provision(instance: &Instance) -> Result<()> {
    let url = format!("http://localhost:{}/", instance.port(Port::LocalStack));
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building tokio runtime")?;
    rt.block_on(provision_async(&url))
}

async fn provision_async(url: &str) -> Result<()> {
    let cfg = macro_aws_config::local_aws_config(url).await;

    let sqs = aws_sdk_sqs::Client::new(&cfg);
    let ddb = aws_sdk_dynamodb::Client::new(&cfg);
    let kms = aws_sdk_kms::Client::new(&cfg);
    let s3 = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&cfg)
            .force_path_style(true)
            .build(),
    );

    // The four groups are independent — run them concurrently.
    let (q, t, b, k) = tokio::join!(
        create_queues(&sqs),
        create_tables(&ddb),
        create_buckets(&s3),
        create_kms_keys(&kms)
    );
    q?;
    t?;
    b?;
    k?;

    // Dependent: wire doc-storage ObjectCreated -> document-upload-finalizer-queue.
    wire_upload_finalizer(&sqs, &s3).await?;
    Ok(())
}

/// The KMS key that encrypts users' Cursor API keys, addressed by a stable
/// alias so the compose env can name it.
///
/// Idempotent by checking the alias first rather than by swallowing a
/// create-alias conflict: `CreateKey` always succeeds and always mints a new
/// key, so an unconditional call would orphan one key per run.
///
/// A local key is disposable. Tearing LocalStack down loses it, and any
/// `cursor_api_keys` rows encrypted under it become permanently undecryptable —
/// the rows survive in Postgres but their CMK does not. That is fine for local
/// (paste the key again) and is deliberately not repaired here: clearing user
/// rows from a dev provisioning script would be a surprising place to delete
/// data.
///
/// LocalStack does enforce the encryption context, which was worth checking
/// rather than assuming: probed against `localstack/localstack:4`, a `Decrypt`
/// with a different context — or with none — fails with
/// `InvalidCiphertextException`, exactly as real KMS does. So the binding that
/// stops one user's ciphertext decrypting under another user's id is live
/// locally too, and a local stack is a fair test of it.
async fn create_kms_keys(kms: &aws_sdk_kms::Client) -> Result<()> {
    let alias = resources::CURSOR_API_KEY_KMS_ALIAS;
    let existing = kms
        .list_aliases()
        .send()
        .await
        .context("listing kms aliases")?;
    if existing
        .aliases()
        .iter()
        .any(|entry| entry.alias_name() == Some(alias))
    {
        return Ok(());
    }

    let key = kms
        .create_key()
        .description("Cursor API key encryption key (local)")
        .send()
        .await
        .context("creating the cursor api key kms key")?;
    let key_id = key
        .key_metadata()
        .map(|metadata| metadata.key_id())
        .context("kms create_key returned no key metadata")?;

    ignore_exists(
        kms.create_alias()
            .alias_name(alias)
            .target_key_id(key_id)
            .send()
            .await
            .map(|_| ()),
        &format!("kms alias {alias}"),
    )
}

async fn create_queues(sqs: &aws_sdk_sqs::Client) -> Result<()> {
    for queue in resources::QUEUES {
        let name = queue.name;
        let mut request = sqs.create_queue().queue_name(name);
        if name.ends_with(".fifo") {
            request = request.attributes(aws_sdk_sqs::types::QueueAttributeName::FifoQueue, "true");
        }
        ignore_exists(request.send().await.map(|_| ()), &format!("queue {name}"))?;
    }
    Ok(())
}

async fn create_buckets(s3: &aws_sdk_s3::Client) -> Result<()> {
    for bucket in resources::BUCKETS {
        let name = bucket.name;
        ignore_exists(
            s3.create_bucket().bucket(name).send().await.map(|_| ()),
            &format!("bucket {name}"),
        )?;
        let cors = s3_types::CorsConfiguration::builder()
            .cors_rules(
                s3_types::CorsRule::builder()
                    .allowed_origins("*")
                    .allowed_methods("GET")
                    .allowed_methods("PUT")
                    .allowed_methods("POST")
                    .allowed_methods("DELETE")
                    .allowed_methods("HEAD")
                    .allowed_headers("*")
                    .expose_headers("ETag")
                    .max_age_seconds(3600)
                    .build()
                    .context("building CORS rule")?,
            )
            .build()
            .context("building CORS config")?;
        s3.put_bucket_cors()
            .bucket(name)
            .cors_configuration(cors)
            .send()
            .await
            .with_context(|| format!("setting CORS on {name}"))?;
    }
    Ok(())
}

async fn create_tables(ddb: &aws_sdk_dynamodb::Client) -> Result<()> {
    use ddb_types::{
        AttributeDefinition, BillingMode, GlobalSecondaryIndex, KeySchemaElement, KeyType,
        Projection, ProjectionType, ScalarAttributeType,
    };

    let attr = |name: &str| {
        AttributeDefinition::builder()
            .attribute_name(name)
            .attribute_type(ScalarAttributeType::S)
            .build()
    };
    let key = |name: &str, kt: KeyType| {
        KeySchemaElement::builder()
            .attribute_name(name)
            .key_type(kt)
            .build()
    };
    let all = || {
        Projection::builder()
            .projection_type(ProjectionType::All)
            .build()
    };

    // bulk-upload (PK HASH, SK RANGE; GSI DocumentPkIndex on SK).
    ignore_exists(
        ddb.create_table()
            .table_name(resources::BULK_UPLOAD_TABLE)
            .attribute_definitions(attr("PK")?)
            .attribute_definitions(attr("SK")?)
            .key_schema(key("PK", KeyType::Hash)?)
            .key_schema(key("SK", KeyType::Range)?)
            .billing_mode(BillingMode::PayPerRequest)
            .global_secondary_indexes(
                GlobalSecondaryIndex::builder()
                    .index_name("DocumentPkIndex")
                    .key_schema(key("SK", KeyType::Hash)?)
                    .projection(all())
                    .build()
                    .context("bulk-upload GSI")?,
            )
            .send()
            .await
            .map(|_| ()),
        "table bulk-upload",
    )?;

    // connection-gateway-table (PK HASH, SK RANGE; GSI ConnectionPkIndex SK HASH + PK RANGE).
    ignore_exists(
        ddb.create_table()
            .table_name(resources::CONNECTION_GATEWAY_TABLE)
            .attribute_definitions(attr("PK")?)
            .attribute_definitions(attr("SK")?)
            .key_schema(key("PK", KeyType::Hash)?)
            .key_schema(key("SK", KeyType::Range)?)
            .billing_mode(BillingMode::PayPerRequest)
            .global_secondary_indexes(
                GlobalSecondaryIndex::builder()
                    .index_name("ConnectionPkIndex")
                    .key_schema(key("SK", KeyType::Hash)?)
                    .key_schema(key("PK", KeyType::Range)?)
                    .projection(all())
                    .build()
                    .context("connection-gateway GSI")?,
            )
            .send()
            .await
            .map(|_| ()),
        "table connection-gateway-table",
    )?;

    // static-file-metadata (file_id HASH).
    ignore_exists(
        ddb.create_table()
            .table_name(resources::STATIC_FILE_TABLE)
            .attribute_definitions(attr("file_id")?)
            .key_schema(key("file_id", KeyType::Hash)?)
            .billing_mode(BillingMode::PayPerRequest)
            .send()
            .await
            .map(|_| ()),
        "table static-file-metadata",
    )?;

    Ok(())
}

/// Configure doc-storage S3 ObjectCreated events to publish to the upload
/// finalizer SQS queue (mirrors `tooling/just/local_stack.just`).
async fn wire_upload_finalizer(sqs: &aws_sdk_sqs::Client, s3: &aws_sdk_s3::Client) -> Result<()> {
    let queue_url = resources::queue_url(resources::UPLOAD_FINALIZER_QUEUE);
    let queue_arn = resources::queue_arn(resources::UPLOAD_FINALIZER_QUEUE);
    let source_arn = format!("arn:aws:s3:::{}", resources::DOC_STORAGE_BUCKET);

    let policy = serde_json::json!({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": "*",
            "Action": "sqs:SendMessage",
            "Resource": queue_arn,
            "Condition": { "ArnEquals": { "aws:SourceArn": source_arn } },
        }],
    })
    .to_string();

    sqs.set_queue_attributes()
        .queue_url(&queue_url)
        .attributes(aws_sdk_sqs::types::QueueAttributeName::Policy, policy)
        .send()
        .await
        .context("setting upload-finalizer queue policy")?;

    let config = s3_types::NotificationConfiguration::builder()
        .queue_configurations(
            s3_types::QueueConfiguration::builder()
                .id("document-upload-finalizer")
                .queue_arn(&queue_arn)
                .events(s3_types::Event::from("s3:ObjectCreated:*"))
                .build()
                .context("building queue notification config")?,
        )
        .build();
    s3.put_bucket_notification_configuration()
        .bucket(resources::DOC_STORAGE_BUCKET)
        .notification_configuration(config)
        .send()
        .await
        .context("configuring doc-storage notifications")?;
    Ok(())
}

/// Map "already exists" service errors to success; propagate everything else.
fn ignore_exists<E: std::fmt::Debug>(result: Result<(), E>, what: &str) -> Result<()> {
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            let s = format!("{e:?}");
            if s.contains("AlreadyExists")
                || s.contains("ResourceInUseException")
                || s.contains("BucketAlreadyOwnedByYou")
                || s.contains("QueueNameExists")
            {
                Ok(())
            } else {
                anyhow::bail!("creating {what} failed: {s}")
            }
        }
    }
}
