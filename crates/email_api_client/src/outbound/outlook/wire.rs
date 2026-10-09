use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub(super) struct Page<T> {
    pub value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    pub next: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    pub delta: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Folder {
    pub id: String,
    pub parent_folder_id: Option<String>,
    pub display_name: String,
    #[serde(default)]
    pub child_folder_count: u32,
    #[serde(default)]
    pub single_value_extended_properties: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
pub(super) struct Change {
    pub id: String,
    #[serde(rename = "@removed")]
    pub removed: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Recipient {
    pub email_address: Address,
}

#[derive(Deserialize, Serialize)]
pub(super) struct Address {
    pub address: String,
    pub name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Body {
    pub content_type: String,
    pub content: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct Flag {
    pub flag_status: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub(super) struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Message {
    #[serde(default)]
    pub single_value_extended_properties: Vec<ExtendedProperty>,
    #[serde(rename = "@odata.type")]
    pub resource_type: Option<String>,
    #[serde(rename = "@odata.etag")]
    pub etag: Option<String>,
    pub id: String,
    pub conversation_id: String,
    pub parent_folder_id: Option<String>,
    pub web_link: Option<String>,
    pub internet_message_id: Option<String>,
    pub subject: Option<String>,
    pub body_preview: Option<String>,
    pub body: Option<Body>,
    pub from: Option<Recipient>,
    #[serde(default)]
    pub to_recipients: Vec<Recipient>,
    #[serde(default)]
    pub cc_recipients: Vec<Recipient>,
    #[serde(default)]
    pub bcc_recipients: Vec<Recipient>,
    #[serde(default)]
    pub is_read: bool,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub flag: Flag,
    #[serde(default)]
    pub categories: Vec<String>,
    pub inference_classification: Option<String>,
    pub received_date_time: Option<DateTime<Utc>>,
    pub sent_date_time: Option<DateTime<Utc>>,
    pub created_date_time: Option<DateTime<Utc>>,
    pub last_modified_date_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub internet_message_headers: Vec<Header>,
}

#[derive(Deserialize)]
pub(super) struct ExtendedProperty {
    pub id: String,
    pub value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attachment {
    #[serde(rename = "@odata.type")]
    pub resource_type: Option<String>,
    pub id: String,
    pub name: Option<String>,
    pub content_type: Option<String>,
    pub size: Option<i64>,
    pub content_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Subscription {
    pub id: String,
    pub expiration_date_time: DateTime<Utc>,
}
