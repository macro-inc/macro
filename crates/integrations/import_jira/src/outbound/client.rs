//! Jira Cloud v3 reads through Pipedream's OAuth proxy.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use http::Method;
use import_tracker::domain::model::{
    Comment, Group, GroupKind, Inventory, Issue, ObjectId, TrackerConnections, TrackerError, User,
};
use import_tracker::outbound::pipedream::{Connections, Session};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

mod adf;
mod wire;
use wire::*;

#[cfg(test)]
mod test;

/// The closed set of Jira reads. The only POST is the enhanced JQL search;
/// callers cannot supply an arbitrary URL, method, or request body.
#[derive(Debug, Clone)]
pub enum JiraRead {
    /// Discover sites accessible to this OAuth account.
    Resources,
    /// One page of visible projects.
    Projects {
        /// Site identity.
        cloud: ObjectId,
        /// Offset.
        start: usize,
    },
    /// Enhanced search, including all issue fields needed by the importer.
    Search {
        /// Site identity.
        cloud: ObjectId,
        /// Opaque continuation token.
        token: Option<String>,
    },
    /// One page of issue comments.
    Comments {
        /// Site identity.
        cloud: ObjectId,
        /// Issue id.
        issue: ObjectId,
        /// Offset.
        start: usize,
    },
    /// One page of visible users.
    Users {
        /// Site identity.
        cloud: ObjectId,
        /// Offset.
        start: usize,
    },
    /// Field metadata, for locating legacy Epic Link fields.
    Fields {
        /// Site identity.
        cloud: ObjectId,
    },
}

impl JiraRead {
    /// Jira accepts enhanced issue search as a read-only POST.
    pub fn method(&self) -> Method {
        match self {
            Self::Search { .. } => Method::POST,
            _ => Method::GET,
        }
    }

    /// The fixed Atlassian URL for this read.
    pub fn url(&self) -> String {
        let (cloud, path) = match self {
            Self::Resources => {
                return "https://api.atlassian.com/oauth/token/accessible-resources".into();
            }
            Self::Projects { cloud, start } => (
                cloud,
                format!("project/search?maxResults=100&startAt={start}"),
            ),
            Self::Search { cloud, .. } => (cloud, "search/jql".into()),
            Self::Comments {
                cloud,
                issue,
                start,
            } => (
                cloud,
                format!(
                    "issue/{}/comment?maxResults=100&startAt={start}",
                    issue.as_str()
                ),
            ),
            Self::Users { cloud, start } => (
                cloud,
                format!("users/search?maxResults=100&startAt={start}"),
            ),
            Self::Fields { cloud } => (cloud, "field".into()),
        };
        format!(
            "https://api.atlassian.com/ex/jira/{}/rest/api/3/{path}",
            cloud.as_str()
        )
    }

    /// Fixed search body. Jira requires bounded JQL, so an all-project import
    /// searches issues with a project and orders by stable issue identity.
    pub fn body(&self) -> Option<Value> {
        match self {
            Self::Search { token, .. } => {
                let mut body = json!({"jql": "project IS NOT EMPTY ORDER BY id ASC", "maxResults": 100, "fields": ["*all"]});
                if let Some(token) = token {
                    body["nextPageToken"] = json!(token);
                }
                Some(body)
            }
            _ => None,
        }
    }
}

/// Jira connections backed by enabled Pipedream `jira` accounts.
pub struct PipedreamJiraConnections<Store, Proxy>(Connections<Store, Proxy>);

impl<Store: ConnectionStore, Proxy: ConnectedAppProxy> PipedreamJiraConnections<Store, Proxy> {
    /// Space calls on each account and honor Jira's retry budget.
    pub fn new(store: Arc<Store>, proxy: Option<Arc<Proxy>>) -> Self {
        Self(Connections::new(
            store,
            proxy,
            "jira",
            Duration::from_millis(350),
        ))
    }
}

#[async_trait]
impl<Store: ConnectionStore, Proxy: ConnectedAppProxy> TrackerConnections
    for PipedreamJiraConnections<Store, Proxy>
{
    #[tracing::instrument(skip_all, err)]
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(usize, usize) + Send + Sync),
    ) -> Result<Inventory, TrackerError> {
        let client = Client(self.0.open(user).await?);
        let sites: Vec<Site> = client.request(JiraRead::Resources).await?;
        let mut inventory = Inventory::default();
        for site in sites
            .into_iter()
            .filter(|site| site.scopes.iter().any(|scope| scope.contains("jira")))
        {
            client.site(&site, &mut inventory, progress).await?;
        }
        Ok(inventory)
    }
}

struct Client<Proxy>(Session<Proxy>);

impl<Proxy: ConnectedAppProxy> Client<Proxy> {
    async fn request<T: DeserializeOwned>(&self, read: JiraRead) -> Result<T, TrackerError> {
        serde_json::from_value(
            self.0
                .read(read.method(), &read.url(), read.body().as_ref())
                .await?,
        )
        .map_err(|error| TrackerError::Decode(error.to_string()))
    }

    async fn site(
        &self,
        site: &Site,
        inventory: &mut Inventory,
        progress: &(dyn Fn(usize, usize) + Send + Sync),
    ) -> Result<(), TrackerError> {
        let mut start = 0;
        loop {
            let page: Projects = self
                .request(JiraRead::Projects {
                    cloud: site.id.clone(),
                    start,
                })
                .await?;
            let count = page.values.len();
            for raw in page.values {
                let project: Project = match serde_json::from_value(raw) {
                    Ok(project) => project,
                    Err(error) => {
                        inventory.warnings.push(
                            format!("Skipped an unreadable Jira project: {error}")
                                .chars()
                                .take(500)
                                .collect(),
                        );
                        continue;
                    }
                };
                inventory.groups.push(Group {
                    id: scoped(&site.id, &project.id)?,
                    title: project.name,
                    kind: GroupKind::Project,
                    parent: None,
                    url: Some(format!(
                        "{}/plugins/servlet/project-config/{}",
                        site.url.trim_end_matches('/'),
                        project.key
                    )),
                    description: project.description,
                });
            }
            progress(inventory.issues.len(), inventory.groups.len());
            if page.is_last {
                break;
            }
            if count == 0 {
                return Err(TrackerError::Decode(
                    "Jira projects pagination made no progress".into(),
                ));
            }
            start += count;
        }
        // Some Jira grants cannot list users; issue-level assignee email is
        // still preserved when visible. Never fail a whole workspace for this.
        let mut start = 0;
        loop {
            let users: Vec<Value> = match self
                .request(JiraRead::Users {
                    cloud: site.id.clone(),
                    start,
                })
                .await
            {
                Ok(users) => users,
                Err(TrackerError::Forbidden(_)) => {
                    inventory.warnings.push(format!(
                        "{} does not allow listing users; assignees use visible issue emails.",
                        site.name
                    ));
                    break;
                }
                Err(error) => return Err(error),
            };
            let count = users.len();
            for raw in users {
                let user: WireUser = match serde_json::from_value(raw) {
                    Ok(user) => user,
                    Err(error) => {
                        inventory.warnings.push(
                            format!("Skipped an unreadable Jira user: {error}")
                                .chars()
                                .take(500)
                                .collect(),
                        );
                        continue;
                    }
                };
                inventory.users.push(User {
                    id: scoped(&site.id, &user.account_id)?,
                    name: user.display_name,
                    email: user.email_address,
                });
            }
            if count < 100 {
                break;
            }
            start += count;
        }
        let fields: Vec<WireField> = self
            .request(JiraRead::Fields {
                cloud: site.id.clone(),
            })
            .await?;
        let epic_field = fields
            .iter()
            .find(|f| {
                f.schema.as_ref().and_then(|s| s.custom.as_deref())
                    == Some("com.pyxis.greenhopper.jira:gh-epic-link")
            })
            .map(|f| f.id.as_str());
        let mut token = None;
        let mut seen_tokens = HashSet::new();
        let mut seen_issues = HashSet::new();
        let mut issues = Vec::new();
        loop {
            let page: SearchPage = self
                .request(JiraRead::Search {
                    cloud: site.id.clone(),
                    token,
                })
                .await?;
            for raw in page.issues {
                let issue: WireIssue = match serde_json::from_value(raw) {
                    Ok(issue) => issue,
                    Err(error) => {
                        inventory.warnings.push(
                            format!("Skipped an unreadable Jira issue: {error}")
                                .chars()
                                .take(500)
                                .collect(),
                        );
                        continue;
                    }
                };
                if seen_issues.insert(issue.id.clone()) {
                    issues.push(issue);
                }
            }
            if page.is_last {
                break;
            }
            let next = page
                .next_page_token
                .filter(|token| !token.is_empty())
                .ok_or_else(|| TrackerError::Decode("missing Jira nextPageToken".into()))?;
            if !seen_tokens.insert(next.clone()) {
                return Err(TrackerError::Decode("Jira search cursor repeated".into()));
            }
            token = Some(next);
        }
        let epic_keys: std::collections::HashMap<String, ObjectId> = issues
            .iter()
            .filter(|issue| issue.fields.issue_type.is_epic())
            .map(|issue| Ok((issue.key.clone(), scoped(&site.id, &issue.id)?)))
            .collect::<Result<_, TrackerError>>()?;
        for issue in issues {
            let fields = issue.fields;
            let id = scoped(&site.id, &issue.id)?;
            let project = scoped(&site.id, &fields.project.id)?;
            let parent = fields
                .parent
                .as_ref()
                .map(|p| scoped(&site.id, &p.id))
                .transpose()?;
            let epic = epic_field
                .and_then(|field| fields.custom.get(field))
                .and_then(Value::as_str)
                .and_then(|key| epic_keys.get(key))
                .cloned();
            let mut comments = Vec::new();
            let mut start = 0;
            loop {
                let page: Comments = self
                    .request(JiraRead::Comments {
                        cloud: site.id.clone(),
                        issue: issue.id.clone(),
                        start,
                    })
                    .await?;
                let count = page.comments.len();
                for raw in page.comments {
                    let c: WireComment = match serde_json::from_value(raw) {
                        Ok(comment) => comment,
                        Err(error) => {
                            inventory.warnings.push(
                                format!("Skipped an unreadable Jira comment: {error}")
                                    .chars()
                                    .take(500)
                                    .collect(),
                            );
                            continue;
                        }
                    };
                    comments.push(Comment {
                        id: scoped(&site.id, &c.id)?,
                        author: c
                            .author
                            .map(|u| u.display_name)
                            .unwrap_or_else(|| "Unknown author".into()),
                        body: adf::markdown(&c.body),
                        created_at: Some(c.created),
                    });
                }
                start += count;
                if start >= page.total {
                    break;
                }
                if count == 0 {
                    return Err(TrackerError::Decode(
                        "Jira comments pagination made no progress".into(),
                    ));
                }
            }
            let url = format!("{}/browse/{}", site.url.trim_end_matches('/'), issue.key);
            if fields.issue_type.is_epic() {
                inventory.groups.push(Group {
                    id: ObjectId::parse(format!("epic:{}", id.as_str()))?,
                    title: fields.summary.clone(),
                    kind: GroupKind::Epic,
                    parent: Some(project.clone()),
                    url: Some(url.clone()),
                    description: Some(adf::markdown(&fields.description)),
                });
            }
            inventory.issues.push(Issue {
                id,
                identifier: issue.key,
                title: fields.summary,
                description: adf::markdown(&fields.description),
                status: fields.status.name,
                status_category: fields.status.status_category.key,
                issue_type: Some(fields.issue_type.name),
                priority: fields.priority.map(|p| p.name),
                assignee_email: fields.assignee.and_then(|u| u.email_address),
                due_date: fields.duedate,
                labels: fields.labels,
                estimate: None,
                parent: parent.clone().or_else(|| epic.clone()),
                group: parent
                    .filter(|p| epic_keys.values().any(|id| id == p))
                    .or(epic)
                    .map(|epic| ObjectId::parse(format!("epic:{}", epic.as_str())))
                    .transpose()?
                    .or(Some(project)),
                team: None,
                cycle: None,
                url,
                comments,
            });
            progress(inventory.issues.len(), inventory.groups.len());
        }
        Ok(())
    }
}

fn scoped(cloud: &ObjectId, id: &ObjectId) -> Result<ObjectId, TrackerError> {
    ObjectId::parse(format!("{}:{}", cloud.as_str(), id.as_str()))
}
