use aws_sdk_dynamodb::{
    Client,
    error::{DisplayErrorContext, SdkError},
    types::AttributeValue,
};
use models_bulk_upload::{
    BulkUploadRequest, BulkUploadRequestDocuments, ProjectDocumentStatus, UploadDocumentStatus,
    UploadFolderStatus,
};
use std::collections::HashMap;
use std::str::FromStr;
use tracing::{error, info};

const REQUEST_PK_PREFIX: &str = "REQUEST#";
const REQUEST_SK: &str = "META";
const DOCUMENT_SK_PREFIX: &str = "DOCUMENT#";
const UNZIP_REQUEST_ENTITY_TYPE: &str = "BulkUploadZipRequest";

pub async fn create_bulk_upload_request(
    client: &Client,
    table: &str,
    request_id: &str,
    user_id: &str,
    key: &str,
    name: Option<&str>,
    parent_id: Option<&str>,
) -> anyhow::Result<BulkUploadRequest> {
    let now = chrono::Utc::now().to_rfc3339();
    let pk = format!("{}{}", REQUEST_PK_PREFIX, request_id);

    let status = UploadFolderStatus::Pending;

    let mut item = HashMap::new();
    item.insert("PK".to_string(), AttributeValue::S(pk));
    item.insert("SK".to_string(), AttributeValue::S(REQUEST_SK.to_string()));
    item.insert(
        "request_id".to_string(),
        AttributeValue::S(request_id.to_string()),
    );
    item.insert(
        "user_id".to_string(),
        AttributeValue::S(user_id.to_string()),
    );
    item.insert("key".to_string(), AttributeValue::S(key.to_string()));
    if let Some(name) = name {
        item.insert("name".to_string(), AttributeValue::S(name.to_string()));
    }
    if let Some(parent_id) = parent_id {
        item.insert(
            "parent_id".to_string(),
            AttributeValue::S(parent_id.to_string()),
        );
    }
    item.insert("status".to_string(), AttributeValue::S(status.to_string()));
    item.insert("created_at".to_string(), AttributeValue::S(now.clone()));
    item.insert("updated_at".to_string(), AttributeValue::S(now));
    item.insert(
        "entity_type".to_string(),
        AttributeValue::S(UNZIP_REQUEST_ENTITY_TYPE.to_string()),
    );

    client
        .put_item()
        .table_name(table)
        .set_item(Some(item.clone()))
        .send()
        .await
        .map_err(map_sdk_err)?;

    info!("Created bulk upload request: {}", request_id);

    let request = get_request_for_item(&item)?;

    Ok(request)
}

pub async fn update_bulk_upload_request_status(
    client: &Client,
    table: &str,
    request_id: &str,
    status: &str,
    error_message: Option<&str>,
    root_project_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let pk = format!("{}{}", REQUEST_PK_PREFIX, request_id);

    let mut update_expression = "SET #status = :status, #updated_at = :updated_at".to_string();
    let mut expression_attribute_names = HashMap::new();
    expression_attribute_names.insert("#status".to_string(), "status".to_string());
    expression_attribute_names.insert("#updated_at".to_string(), "updated_at".to_string());

    let mut expression_attribute_values = HashMap::new();
    expression_attribute_values
        .insert(":status".to_string(), AttributeValue::S(status.to_string()));
    expression_attribute_values.insert(":updated_at".to_string(), AttributeValue::S(now.clone()));

    if status == "COMPLETED" || status == "FAILED" {
        update_expression.push_str(", #completed_at = :completed_at");
        expression_attribute_names.insert("#completed_at".to_string(), "completed_at".to_string());
        expression_attribute_values.insert(":completed_at".to_string(), AttributeValue::S(now));
    }

    update_expression.push_str(", #error_message = :error_message");
    expression_attribute_names.insert("#error_message".to_string(), "error_message".to_string());
    expression_attribute_values.insert(
        ":error_message".to_string(),
        match error_message {
            Some(msg) => AttributeValue::S(msg.to_string()),
            None => AttributeValue::Null(true),
        },
    );

    if let Some(root_project_id) = root_project_id {
        update_expression.push_str(", #root_project_id = :root_project_id");
        expression_attribute_names.insert(
            "#root_project_id".to_string(),
            "root_project_id".to_string(),
        );
        expression_attribute_values.insert(
            ":root_project_id".to_string(),
            AttributeValue::S(root_project_id.to_string()),
        );
    }

    client
        .update_item()
        .table_name(table)
        .key("PK", AttributeValue::S(pk))
        .key("SK", AttributeValue::S(REQUEST_SK.to_string()))
        .update_expression(update_expression)
        .set_expression_attribute_names(Some(expression_attribute_names))
        .set_expression_attribute_values(Some(expression_attribute_values))
        .send()
        .await
        .map_err(map_sdk_err)?;

    info!(
        "Updated bulk upload request status to {}: {}",
        status, request_id
    );
    Ok(())
}

pub async fn get_bulk_upload_request(
    client: &Client,
    table: &str,
    request_id: &str,
) -> anyhow::Result<BulkUploadRequest> {
    let pk = format!("{}{}", REQUEST_PK_PREFIX, request_id);

    let result = client
        .get_item()
        .table_name(table)
        .key("PK", AttributeValue::S(pk))
        .key("SK", AttributeValue::S(REQUEST_SK.to_string()))
        .send()
        .await
        .map_err(map_sdk_err)?;

    let item = result.item().ok_or_else(|| {
        error!("Bulk upload request not found: {}", request_id);
        anyhow::anyhow!("Bulk upload request not found: {}", request_id)
    })?;

    let request = get_request_for_item(item)?;

    Ok(request)
}

pub async fn get_bulk_upload_document_statuses(
    client: &Client,
    table: &str,
    request_id: &str,
) -> anyhow::Result<BulkUploadRequestDocuments> {
    let pk = format!("{}{}", REQUEST_PK_PREFIX, &request_id);

    // Query all items for request
    let query_result = client
        .query()
        .table_name(table)
        .key_condition_expression("PK = :pk")
        .projection_expression("SK, root_project_id, #status")
        .expression_attribute_names("#status", "status")
        .expression_attribute_values(":pk", AttributeValue::S(pk))
        .send()
        .await
        .map_err(map_sdk_err)?;

    let items = query_result
        .items
        .ok_or_else(|| anyhow::anyhow!("No items found for request {}", request_id))?;

    let mut root_project_id = None;
    let mut document_statuses = Vec::new();

    for item in items {
        let sk = item
            .get("SK")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Missing SK in item"))?;

        if sk == REQUEST_SK {
            // request meta item
            root_project_id = item
                .get("root_project_id")
                .and_then(|v| v.as_s().ok())
                .map(|s| s.to_string());
        } else {
            let document_id = sk.trim_start_matches(DOCUMENT_SK_PREFIX).to_string();

            let status = item
                .get("status")
                .and_then(|v| v.as_s().ok())
                .and_then(|s| UploadDocumentStatus::from_str(s).ok())
                .unwrap_or_default();

            document_statuses.push(ProjectDocumentStatus {
                document_id,
                status,
            });
        }
    }

    let root_project_id = root_project_id
        .ok_or_else(|| anyhow::anyhow!("Missing root_project_id for request {}", request_id))?;

    Ok(BulkUploadRequestDocuments {
        root_project_id,
        documents: document_statuses,
    })
}

/// Creates or updates a mapping between a request ID and multiple document IDs
/// This efficiently stores the relationship between a bulk upload request and its documents
pub async fn set_document_request_mappings(
    client: &Client,
    table: &str,
    request_id: &str,
    document_ids: Vec<String>,
    document_status: UploadDocumentStatus,
) -> anyhow::Result<()> {
    if document_ids.is_empty() {
        return Ok(());
    }

    let status = document_status.to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut batch_items = Vec::new();
    const MAX_BATCH_SIZE: usize = 25;

    for chunk in document_ids.chunks(MAX_BATCH_SIZE) {
        let mut request_items = Vec::new();

        for document_id in chunk {
            let mut item = HashMap::new();
            let pk = format!("{}{}", REQUEST_PK_PREFIX, request_id);
            let sk = format!("{}{}", DOCUMENT_SK_PREFIX, document_id);

            item.insert("PK".to_string(), AttributeValue::S(pk));
            item.insert("SK".to_string(), AttributeValue::S(sk));
            item.insert(
                "request_id".to_string(),
                AttributeValue::S(request_id.to_string()),
            );
            item.insert(
                "document_id".to_string(),
                AttributeValue::S(document_id.to_string()),
            );
            item.insert("status".to_string(), AttributeValue::S(status.to_string()));
            item.insert("created_at".to_string(), AttributeValue::S(now.clone()));
            item.insert("updated_at".to_string(), AttributeValue::S(now.clone()));
            item.insert(
                "entity_type".to_string(),
                AttributeValue::S("Document".to_string()),
            );

            if let Ok(put_request) = aws_sdk_dynamodb::types::PutRequest::builder()
                .set_item(Some(item))
                .build()
            {
                request_items.push(
                    aws_sdk_dynamodb::types::WriteRequest::builder()
                        .put_request(put_request)
                        .build(),
                );
            }
        }

        if !request_items.is_empty() {
            let mut batch_request = HashMap::new();
            batch_request.insert(table.to_string(), request_items);
            batch_items.push(batch_request);
        }
    }

    for batch in batch_items {
        let mut unprocessed_items = batch;
        let mut retry_count = 0;
        const MAX_RETRIES: usize = 3;

        while !unprocessed_items.is_empty() && retry_count < MAX_RETRIES {
            let result = client
                .batch_write_item()
                .set_request_items(Some(unprocessed_items.clone()))
                .send()
                .await
                .map_err(map_sdk_err)?;

            if let Some(items) = result.unprocessed_items() {
                if items.is_empty() {
                    break;
                }
                unprocessed_items = items.clone();
                retry_count += 1;
                if retry_count < MAX_RETRIES {
                    let backoff_ms = 2u64.pow(retry_count as u32) * 50;
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                }
            } else {
                break;
            }
        }

        if !unprocessed_items.is_empty() {
            error!(
                "Unprocessed items after retries: {}",
                unprocessed_items.values().map(|v| v.len()).sum::<usize>()
            );
        }
    }

    info!(
        "Mapped {} documents to request ID: {}",
        document_ids.len(),
        request_id
    );

    Ok(())
}

pub fn map_sdk_err<E, R>(sdk_err: SdkError<E, R>) -> anyhow::Error
where
    E: std::error::Error + 'static,
    R: std::fmt::Debug + 'static,
{
    anyhow::anyhow!("Unhandled SDK error: {}", DisplayErrorContext(&sdk_err))
}

fn get_request_for_item(
    item: &HashMap<String, AttributeValue>,
) -> anyhow::Result<BulkUploadRequest> {
    let request = BulkUploadRequest {
        request_id: item
            .get("request_id")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("invalid request_id"))?,
        user_id: item
            .get("user_id")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("invalid user_id"))?,
        key: item
            .get("key")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("invalid key"))?,
        name: item
            .get("name")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string()),
        status: item
            .get("status")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .and_then(|s| UploadFolderStatus::from_str(s.as_str()).ok())
            .unwrap_or_default(),
        created_at: item
            .get("created_at")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .unwrap_or_default(),
        updated_at: item
            .get("updated_at")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string())
            .unwrap_or_default(),
        completed_at: item
            .get("completed_at")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string()),
        error_message: item
            .get("error_message")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string()),
        root_project_id: item
            .get("root_project_id")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string()),
        parent_id: item
            .get("parent_id")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.to_string()),
    };

    Ok(request)
}
