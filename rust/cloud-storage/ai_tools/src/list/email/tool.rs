use crate::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use models_email::{
    email::service::thread::{GetPreviewsCursorResponse, PreviewView},
    service::thread::PreviewViewStandardLabel,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Choose the view to list emails from. One of either standard label or user label must be specified, otherwise defaults to important."
)]
pub struct ViewSelection {
    #[schemars(description = "Prefer important or all. Leave empty if using a user label")]
    pub standard_label: Option<PreviewViewStandardLabel>,
    #[schemars(
        description = "Choose a custom user label to filter by (optional). Standard label will take precedence over user label if both are specified."
    )]
    pub user_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "List the emails the user has access to. Use this tool to discover and browse emails before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.",
    title = "ListEmails"
)]
pub struct ListEmails {
    #[serde(default)]
    pub view: ViewSelection,
    #[schemars(
        description = "limit the max emails returned. This defaults to 20 and has a maximum of 500"
    )]
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[schemars(
        description = "A preview response will tell you what the next cursor id is.
        If expected emails are not in the current response and it gives you a cursor id, use this field to list the next page of emails. If no cursor id is provided you've reached the end"
    )]
    #[serde(default)]
    pub cursor: Option<String>,
    #[schemars(
        description = "Sort response by one of: viewed_at | updated_at | created_at | viewed_updated. Prefer viewed_at unless the otherwise specified"
    )]
    #[serde(default = "default_sort_method")]
    pub sort_method: ApiSortMethod,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiSortMethod {
    ViewedAt,
    UpdatedAt,
    CreatedAt,
    ViewedUpdated,
}

pub fn default_view() -> PreviewView {
    PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
}

pub fn default_limit() -> i64 {
    20
}

pub fn default_sort_method() -> ApiSortMethod {
    ApiSortMethod::ViewedAt
}

impl ListEmails {
    /// get the query string parameters contained within self as an iterator over KV pairs
    pub fn iter_params(&self) -> impl Iterator<Item = (&'static str, Cow<'_, str>)> {
        std::iter::once(("limit", Cow::Owned(self.limit.to_string())))
            .chain(
                self.cursor
                    .iter()
                    .map(|v| ("cursor", Cow::Borrowed(v.as_ref()))),
            )
            .chain(std::iter::once((
                "sort_method",
                Cow::Owned(
                    serde_json::to_string(&self.sort_method)
                        .expect("infallible")
                        .trim_matches('"')
                        .to_string(),
                ),
            )))
    }
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for ListEmails {
    type Output = GetPreviewsCursorResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "List emails params");

        // builds the preview view based on the view selection
        // prefer standard label over user label if both are specified
        let view = self
            .view
            .standard_label
            .as_ref()
            .map(|label| PreviewView::StandardLabel(label.clone()))
            .or(self
                .view
                .user_label
                .as_ref()
                .map(|label| PreviewView::UserLabel(label.clone())))
            .unwrap_or(default_view());

        service_context
            .email_service_client
            .get_thread_previews_external(self.iter_params(), view, &request_context.jwt_token)
            .await
            .map_err(|err| ToolCallError {
                description: format!("something went wrong fetching emails {:?}", err),
                internal_error: err,
            })
    }
}
