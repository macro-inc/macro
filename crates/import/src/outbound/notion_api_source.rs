//! The connected user's Notion workspace, read from Notion's REST API
//! through the Pipedream Connect proxy.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::{ConnectProxyError, ProxyRequest, ProxyResponse};
use pipedream_mcp::domain::ports::ConnectProxy;

use crate::domain::models::{
    ImportSource, NotionBlockPage, NotionContainer, NotionId, NotionOwner, NotionPage,
    NotionParent, NotionSearchPage,
};
use crate::domain::ports::{ApiSourceError, NotionSession, NotionSource};

mod parse;
#[cfg(test)]
mod test;

const NOTION_API: &str = "https://api.notion.com/v1";
/// The pinned API version. 2025-09-03 introduced data sources: database
/// rows name a `data_source_id` parent (with its `database_id` alongside).
const NOTION_VERSION: &str = "2025-09-03";
const PAGE_SIZE: u32 = 100;

/// Reads Notion through the user's Pipedream `notion` connection.
pub struct NotionApiSource<P> {
    proxy: Arc<P>,
}

impl<P> NotionApiSource<P> {
    /// Read through the host's Connect proxy.
    pub fn new(proxy: Arc<P>) -> Self {
        Self { proxy }
    }
}

impl<P: ConnectProxy> NotionSource for NotionApiSource<P> {
    type Session = NotionApiSession<P>;

    fn open(&self, user: &MacroUserIdStr<'static>) -> NotionApiSession<P> {
        NotionApiSession {
            proxy: self.proxy.clone(),
            user: user.clone(),
        }
    }
}

/// Notion reads for one user.
pub struct NotionApiSession<P> {
    proxy: Arc<P>,
    user: MacroUserIdStr<'static>,
}

fn notion_app_slug() -> &'static str {
    ImportSource::Notion.pipedream_app_slugs()[0]
}

impl<P: ConnectProxy> NotionApiSession<P> {
    async fn call(&self, request: ProxyRequest) -> Result<serde_json::Value, ApiSourceError> {
        let response = self
            .proxy
            .send(
                &self.user,
                notion_app_slug(),
                request.header("Notion-Version", NOTION_VERSION),
            )
            .await;
        classify(response)
    }

    async fn get(&self, path: &str) -> Result<serde_json::Value, ApiSourceError> {
        self.call(ProxyRequest::get(format!("{NOTION_API}{path}")))
            .await
    }
}

/// Map one proxied response to its JSON body or a typed failure.
fn classify(
    response: Result<ProxyResponse, ConnectProxyError>,
) -> Result<serde_json::Value, ApiSourceError> {
    let response = match response {
        Ok(response) => response,
        Err(ConnectProxyError::NotConnected { .. }) => {
            return Err(ApiSourceError::NotConnected(ImportSource::Notion));
        }
        Err(error) => return Err(ApiSourceError::Other(error.into())),
    };
    let body: Option<serde_json::Value> = response.json().ok();
    let code = body
        .as_ref()
        .and_then(|body| body.get("code"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    match response.status {
        200..=299 => {
            body.ok_or_else(|| anyhow::anyhow!("Notion returned an unreadable body").into())
        }
        429 => Err(ApiSourceError::RateLimited {
            app: ImportSource::Notion,
            retry_after: response.retry_after,
        }),
        401 => Err(ApiSourceError::Unauthorized(ImportSource::Notion)),
        404 => Err(ApiSourceError::NotFound),
        403 if code == "restricted_resource" => Err(ApiSourceError::NotFound),
        status => {
            let message = body
                .as_ref()
                .and_then(|body| body.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("no error details");
            Err(anyhow::anyhow!("Notion returned {status} {code}: {message}").into())
        }
    }
}

impl<P: ConnectProxy> NotionSession for NotionApiSession<P> {
    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn owner(&self) -> Result<NotionOwner, ApiSourceError> {
        Ok(parse::owner(&self.get("/users/me").await?))
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn search_pages(&self, cursor: Option<&str>) -> Result<NotionSearchPage, ApiSourceError> {
        let mut body = serde_json::json!({
            "filter": { "property": "object", "value": "page" },
            "sort": { "direction": "descending", "timestamp": "last_edited_time" },
            "page_size": PAGE_SIZE,
        });
        if let Some(cursor) = cursor {
            body["start_cursor"] = cursor.into();
        }
        let body = self
            .call(ProxyRequest::post_json(
                format!("{NOTION_API}/search"),
                body,
            ))
            .await?;
        parse::search_page(&body)
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn page(&self, id: &NotionId) -> Result<NotionPage, ApiSourceError> {
        parse::page(&self.get(&format!("/pages/{}", id.dashed())).await?)
            .ok_or_else(|| anyhow::anyhow!("unexpected Notion page shape").into())
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn database(&self, id: &NotionId) -> Result<NotionContainer, ApiSourceError> {
        parse::database(&self.get(&format!("/databases/{}", id.dashed())).await?)
            .ok_or_else(|| anyhow::anyhow!("unexpected Notion database shape").into())
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn data_source_database(&self, id: &NotionId) -> Result<NotionId, ApiSourceError> {
        parse::data_source_database(&self.get(&format!("/data_sources/{}", id.dashed())).await?)
            .ok_or_else(|| anyhow::anyhow!("unexpected Notion data source shape").into())
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn block_parent(&self, id: &NotionId) -> Result<NotionParent, ApiSourceError> {
        let block = self.get(&format!("/blocks/{}", id.dashed())).await?;
        Ok(parse::parent(block.get("parent")))
    }

    #[tracing::instrument(skip(self), err(level = "debug"))]
    async fn children(
        &self,
        id: &NotionId,
        cursor: Option<&str>,
    ) -> Result<NotionBlockPage, ApiSourceError> {
        let mut path = format!("/blocks/{}/children?page_size={PAGE_SIZE}", id.dashed());
        if let Some(cursor) = cursor {
            path.push_str("&start_cursor=");
            path.push_str(&urlencoding::encode(cursor));
        }
        parse::children(&self.get(&path).await?)
    }
}
