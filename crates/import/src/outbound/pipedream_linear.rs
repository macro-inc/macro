//! Reading a person's open Linear issues through their Pipedream Connect
//! grant: Pipedream injects the account's credentials into proxied GraphQL
//! requests, so no model and no MCP tool sits between Macro and Linear.

use std::sync::Arc;

use async_trait::async_trait;
use http::header::{CONTENT_TYPE, HeaderMap, HeaderValue};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore};
use serde::Deserialize;
use serde_json::json;

use crate::domain::models::{ImportSource, LinearIssueMeta};
use crate::domain::ports::{LinearIssueSource, LinearSourceError};
use crate::domain::service::map_linear_status;

#[cfg(test)]
mod test;

/// Linear's GraphQL endpoint.
const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

/// Issues per page; Linear allows up to 250.
const PAGE_SIZE: usize = 100;

/// Whether the person administers their Linear workspace.
const VIEWER: &str = "query Viewer { viewer { admin } }";

/// Issues matching `$filter`, newest first. `state.type` covers custom
/// workflow states that the name alone wouldn't map.
const OPEN_ISSUES: &str = r#"
query OpenIssues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, orderBy: updatedAt, filter: $filter) {
    nodes {
      identifier
      title
      description
      url
      priorityLabel
      dueDate
      state { name type }
      assignee { name email }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"#;

/// Opens people's Linear workspaces from their Pipedream connections.
pub struct PipedreamLinearIssues<Store, Proxy> {
    store: Arc<Store>,
    proxy: Option<Arc<Proxy>>,
}

impl<Store, Proxy> PipedreamLinearIssues<Store, Proxy> {
    /// Connections read from `store`, proxied through `proxy`; with no proxy
    /// (Pipedream unconfigured) nobody has Linear connected.
    pub fn new(store: Arc<Store>, proxy: Option<Arc<Proxy>>) -> Self {
        Self { store, proxy }
    }
}

impl<Store: ConnectionStore, Proxy> PipedreamLinearIssues<Store, Proxy> {
    async fn connection(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<PipedreamConnection>, LinearSourceError> {
        for slug in ImportSource::Linear.pipedream_app_slugs() {
            let connection = self.store.load(user, slug).await.map_err(|error| {
                LinearSourceError::Transport(rootcause::report!(
                    "loading the Linear connection: {error:?}"
                ))
            })?;
            if let Some(connection) = connection.filter(|connection| connection.enabled) {
                return Ok(Some(connection));
            }
        }
        Ok(None)
    }
}

#[derive(Deserialize)]
struct Response<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

#[derive(Deserialize)]
struct Viewer {
    admin: bool,
}

#[derive(Deserialize)]
struct GraphqlError {
    message: String,
}

#[derive(Deserialize)]
struct Data {
    issues: IssuePage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssuePage {
    nodes: Vec<Issue>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issue {
    identifier: String,
    title: String,
    description: Option<String>,
    url: Option<String>,
    priority_label: Option<String>,
    due_date: Option<String>,
    state: Option<State>,
    assignee: Option<Person>,
}

#[derive(Deserialize)]
struct State {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct Person {
    name: Option<String>,
    email: Option<String>,
}

impl From<Issue> for LinearIssueMeta {
    fn from(issue: Issue) -> Self {
        // Custom state names ("In QA") don't map to a Macro status; their
        // type ("started") does.
        let status = issue.state.map(|state| {
            if map_linear_status(&state.name).is_some() {
                state.name
            } else {
                state.kind
            }
        });
        let (assignee, assignee_email) = match issue.assignee {
            Some(person) => (person.name, person.email),
            None => (None, None),
        };
        LinearIssueMeta {
            identifier: Some(issue.identifier),
            title: issue.title,
            description: issue.description,
            status,
            priority: issue
                .priority_label
                .filter(|label| !label.eq_ignore_ascii_case("no priority")),
            assignee,
            assignee_email,
            due_date: issue.due_date,
            url: issue.url,
        }
    }
}

/// Open issues updated in the last 90 days. A workspace admin (usually a
/// founder or lead setting the company up) gets the whole workspace's; anyone
/// else the issues assigned to or created by them, so an engineer doesn't
/// take in the whole team's backlog.
fn open_issues_filter(admin: bool) -> serde_json::Value {
    let mut filter = json!({
        "state": { "type": { "nin": ["completed", "canceled"] } },
        "updatedAt": { "gt": "-P90D" },
    });
    if !admin {
        filter["or"] = json!([
            { "assignee": { "isMe": { "eq": true } } },
            { "creator": { "isMe": { "eq": true } } },
        ]);
    }
    filter
}

/// One GraphQL request through the proxy.
async fn graphql<Proxy: ConnectedAppProxy, T: serde::de::DeserializeOwned>(
    proxy: &Proxy,
    connection: &PipedreamConnection,
    body: &serde_json::Value,
) -> Result<T, LinearSourceError> {
    let headers =
        HeaderMap::from_iter([(CONTENT_TYPE, HeaderValue::from_static("application/json"))]);
    let response = proxy
        .proxy(
            connection,
            http::Method::POST,
            LINEAR_GRAPHQL_URL,
            &headers,
            Some(body),
        )
        .await
        .map_err(|error| LinearSourceError::Transport(rootcause::report!("{error:#}")))?;
    if response.status == http::StatusCode::TOO_MANY_REQUESTS {
        return Err(LinearSourceError::RateLimited);
    }
    if !response.status.is_success() {
        return Err(LinearSourceError::Api(format!(
            "Linear answered {}",
            response.status
        )));
    }
    let page: Response<T> = serde_json::from_str(&response.body)
        .map_err(|error| LinearSourceError::Api(format!("unreadable Linear response: {error}")))?;
    if let Some(error) = page.errors.first() {
        return Err(LinearSourceError::Api(error.message.clone()));
    }
    page.data
        .ok_or_else(|| LinearSourceError::Api("Linear sent no data".to_owned()))
}

// `async_trait`: the import service holds the source as `Arc<dyn …>`.
#[async_trait]
impl<Store, Proxy> LinearIssueSource for PipedreamLinearIssues<Store, Proxy>
where
    Store: ConnectionStore,
    Proxy: ConnectedAppProxy,
{
    #[tracing::instrument(skip_all, fields(limit), err)]
    async fn open_issues(
        &self,
        user: &MacroUserIdStr<'static>,
        limit: usize,
    ) -> Result<Option<Vec<LinearIssueMeta>>, LinearSourceError> {
        let Some(proxy) = &self.proxy else {
            return Ok(None);
        };
        let Some(connection) = self.connection(user).await? else {
            return Ok(None);
        };
        let viewer: ViewerData =
            graphql(proxy.as_ref(), &connection, &json!({ "query": VIEWER })).await?;
        let filter = open_issues_filter(viewer.viewer.admin);
        let mut issues: Vec<LinearIssueMeta> = Vec::new();
        let mut after: Option<String> = None;
        while issues.len() < limit {
            let body = json!({
                "query": OPEN_ISSUES,
                "variables": {
                    "first": PAGE_SIZE.min(limit - issues.len()),
                    "after": after,
                    "filter": filter,
                },
            });
            let data: Data = graphql(proxy.as_ref(), &connection, &body).await?;
            issues.extend(data.issues.nodes.into_iter().map(LinearIssueMeta::from));
            match data.issues.page_info {
                PageInfo {
                    has_next_page: true,
                    end_cursor: Some(cursor),
                } => after = Some(cursor),
                _ => break,
            }
        }
        issues.truncate(limit);
        Ok(Some(issues))
    }
}
