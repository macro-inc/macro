use import_tracker::domain::model::ObjectId;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
pub(super) struct Site {
    pub id: ObjectId,
    pub url: String,
    pub name: String,
    pub scopes: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Projects {
    pub values: Vec<Value>,
    pub is_last: bool,
}
#[derive(Deserialize)]
pub(super) struct Project {
    pub id: ObjectId,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireUser {
    pub account_id: ObjectId,
    pub display_name: String,
    pub email_address: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchPage {
    pub issues: Vec<Value>,
    pub next_page_token: Option<String>,
    pub is_last: bool,
}
#[derive(Deserialize)]
pub(super) struct WireIssue {
    pub id: ObjectId,
    pub key: String,
    pub fields: Fields,
}
#[derive(Deserialize)]
pub(super) struct Ref {
    pub id: ObjectId,
}
#[derive(Deserialize)]
pub(super) struct Named {
    pub name: String,
}
#[derive(Deserialize)]
pub(super) struct Category {
    pub key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Status {
    pub name: String,
    pub status_category: Category,
}
#[derive(Deserialize)]
pub(super) struct Fields {
    pub summary: String,
    #[serde(default)]
    pub description: Value,
    pub status: Status,
    pub priority: Option<Named>,
    pub assignee: Option<WireUser>,
    pub duedate: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    pub parent: Option<Ref>,
    pub project: Ref,
    #[serde(rename = "issuetype")]
    pub issue_type: WireIssueType,
    #[serde(flatten)]
    pub custom: HashMap<String, Value>,
}
#[derive(Deserialize)]
pub(super) struct Comments {
    pub comments: Vec<Value>,
    pub total: usize,
}
#[derive(Deserialize)]
pub(super) struct WireComment {
    pub id: ObjectId,
    pub body: Value,
    pub author: Option<WireUser>,
    pub created: String,
}
#[derive(Deserialize)]
pub(super) struct WireField {
    pub id: String,
    pub schema: Option<FieldSchema>,
}
#[derive(Deserialize)]
pub(super) struct FieldSchema {
    pub custom: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireIssueType {
    pub name: String,
    pub hierarchy_level: Option<i8>,
}
impl WireIssueType {
    pub fn is_epic(&self) -> bool {
        self.hierarchy_level.is_some_and(|level| level >= 1)
            || self.name.eq_ignore_ascii_case("epic")
    }
}
