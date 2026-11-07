use import_tracker::domain::model::ObjectId;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Page<T> {
    pub nodes: Vec<T>,
    pub page_info: PageInfo,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}
#[derive(Deserialize)]
pub(super) struct Ref {
    pub id: ObjectId,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireGroup {
    pub id: ObjectId,
    pub name: String,
    pub description: Option<String>,
    pub url: Option<String>,
    pub parent_initiative: Option<Ref>,
}
#[derive(Deserialize)]
pub(super) struct WireLink {
    pub initiative: Ref,
    pub project: Ref,
}
#[derive(Deserialize)]
pub(super) struct WireCycle {
    pub id: ObjectId,
    pub name: Option<String>,
    pub number: f64,
    pub team: Ref,
}
#[derive(Deserialize)]
pub(super) struct WireState {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Deserialize)]
pub(super) struct WireAssignee {
    pub email: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireIssue {
    pub comments: Page<WireComment>,
    pub labels: Page<WireLabel>,
    pub id: ObjectId,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
    pub due_date: Option<String>,
    pub estimate: Option<f64>,
    pub priority: u8,
    pub state: WireState,
    pub assignee: Option<WireAssignee>,
    pub parent: Option<Ref>,
    pub project: Option<Ref>,
    pub team: Ref,
    pub cycle: Option<Ref>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireComment {
    pub id: ObjectId,
    pub body: String,
    pub created_at: String,
    pub user: Option<WireAuthor>,
}
#[derive(Deserialize)]
pub(super) struct WireAuthor {
    pub name: String,
}
#[derive(Deserialize)]
pub(super) struct WireLabel {
    pub name: String,
}
