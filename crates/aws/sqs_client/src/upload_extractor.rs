use aws_sdk_sqs::{self as sqs};
use std::collections::HashMap;

use crate::{SQS, message_attribute::build_string_message_attribute};

impl SQS {
    pub fn upload_extractor_queue(mut self, upload_extractor_queue: &str) -> Self {
        self.upload_extractor_queue = Some(upload_extractor_queue.to_string());
        self
    }

    // TODO:
    // 1. https://repost.aws/knowledge-center/eventbridge-rule-monitors-s3
    // see infra/stacks/document-storage-bucket-integrations/index.ts
    // 2. ensure that we can map folder upload s3 event to the initial bulk upload dynamodb write
    // and then retrieve that info
    #[tracing::instrument(err, skip(self))]
    pub async fn enqueue_upload_extractor_unzip(
        &self,
        upload_request_id: &str,
        key: &str,
        user_id: &str,
        name: &Option<String>,
        parent_id: &Option<String>,
    ) -> Result<(), anyhow::Error> {
        tracing::debug!(
            "enqueue_upload_extractor_unzip: upload_request_id={}, key={}, user_id={}",
            upload_request_id,
            key,
            user_id
        );

        if let Some(upload_extractor_queue) = &self.upload_extractor_queue {
            return enqueue_upload_extractor(
                &self.inner,
                upload_extractor_queue,
                UploadExtractQueueMessage::ExtractZip(UploadExtractMessage {
                    upload_request_id: upload_request_id.to_string(),
                    key: key.to_string(),
                    user_id: user_id.to_string(),
                    name: name.to_owned(),
                    parent_id: parent_id.to_owned(),
                }),
            )
            .await;
        }

        Err(anyhow::anyhow!("upload_extractor_queue is not configured"))
    }
}

/// Explicitly allowed in case this becomes used in the future
#[allow(dead_code)]
fn construct_message_attributes(
    upload_extract_queue_message: &UploadExtractQueueMessage,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();

    match upload_extract_queue_message {
        UploadExtractQueueMessage::ExtractZip(_) => {
            message_attributes.insert(
                "operation".to_string(),
                build_string_message_attribute(
                    &upload_extract_queue_message.operation().to_string(),
                )?,
            );
        }
    }
    message_attributes.insert(
        "upload_request_id".to_string(),
        build_string_message_attribute(upload_extract_queue_message.upload_request_id())?,
    );
    message_attributes.insert(
        "key".to_string(),
        build_string_message_attribute(upload_extract_queue_message.key())?,
    );
    message_attributes.insert(
        "user_id".to_string(),
        build_string_message_attribute(upload_extract_queue_message.user_id())?,
    );
    if let Some(name) = upload_extract_queue_message.name() {
        message_attributes.insert("name".to_string(), build_string_message_attribute(name)?);
    }

    Ok(message_attributes)
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct UploadExtractMessage {
    pub upload_request_id: String,
    pub key: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

#[derive(serde::Serialize, Debug, strum::Display)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    ExtractZip,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub enum UploadExtractQueueMessage {
    ExtractZip(UploadExtractMessage),
}

impl UploadExtractQueueMessage {
    pub fn operation(&self) -> Operation {
        match self {
            UploadExtractQueueMessage::ExtractZip(_) => Operation::ExtractZip,
        }
    }

    pub fn upload_request_id(&self) -> &String {
        match self {
            UploadExtractQueueMessage::ExtractZip(message) => &message.upload_request_id,
        }
    }

    pub fn key(&self) -> &String {
        match self {
            UploadExtractQueueMessage::ExtractZip(message) => &message.key,
        }
    }

    pub fn user_id(&self) -> &String {
        match self {
            UploadExtractQueueMessage::ExtractZip(message) => &message.user_id,
        }
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            UploadExtractQueueMessage::ExtractZip(message) => message.name.as_deref(),
        }
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_upload_extractor(
    sqs_client: &sqs::Client,
    queue_url: &str,
    message: UploadExtractQueueMessage,
) -> anyhow::Result<()> {
    // NOTE: not needed since we serialize the message body
    // let message_attributes = construct_message_attributes(&message)?;

    let message_str = serde_json::to_string(&message)?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        // .set_message_attributes(Some(message_attributes))
        .message_body(message_str)
        .send()
        .await?;

    Ok(())
}
