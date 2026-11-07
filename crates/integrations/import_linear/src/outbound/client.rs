//! Linear GraphQL inventory through the user's Pipedream grant.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use http::Method;
use import_tracker::domain::model::{
    Comment, Cycle, Group, GroupKind, Inventory, Issue, ObjectId, TrackerConnections, TrackerError,
};
use import_tracker::outbound::pipedream::{Connections, Session};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

mod wire;
use wire::*;

#[cfg(test)]
mod test;

/// Every query an import may issue. Query text is static; callers can provide
/// only GraphQL variables, so a mutation can never enter this client.
#[derive(Debug, Clone, Copy, strum::EnumIter)]
pub enum LinearRead {
    /// Workspace teams.
    Teams,
    /// Workspace projects.
    Projects,
    /// Optional initiatives.
    Initiatives,
    /// Initiative/project membership.
    InitiativeProjects,
    /// Workspace cycles.
    Cycles,
    /// Issues, including archived issues.
    Issues,
    /// Workspace users.
    Users,
    /// One issue's comments.
    Comments,
    /// One issue's labels.
    Labels,
}

impl LinearRead {
    /// Fixed, read-only GraphQL document.
    pub fn query(self) -> &'static str {
        match self {
            Self::Teams => include_str!("client/queries/teams.graphql"),
            Self::Projects => include_str!("client/queries/groups.graphql"),
            Self::Initiatives => include_str!("client/queries/initiatives.graphql"),
            Self::InitiativeProjects => include_str!("client/queries/links.graphql"),
            Self::Cycles => include_str!("client/queries/cycles.graphql"),
            Self::Issues => include_str!("client/queries/issues.graphql"),
            Self::Users => include_str!("client/queries/users.graphql"),
            Self::Comments => include_str!("client/queries/comments.graphql"),
            Self::Labels => include_str!("client/queries/labels.graphql"),
        }
    }

    fn field(self) -> &'static str {
        match self {
            Self::Teams => "teams",
            Self::Projects => "projects",
            Self::Initiatives => "initiatives",
            Self::InitiativeProjects => "initiativeToProjects",
            Self::Cycles => "cycles",
            Self::Issues => "issues",
            Self::Users => "users",
            Self::Comments => "comments",
            Self::Labels => "labels",
        }
    }
}

/// Opens Linear inventories from enabled Pipedream `linear` connections.
pub struct PipedreamLinearConnections<Store, Proxy>(Connections<Store, Proxy>);

impl<Store: ConnectionStore, Proxy: ConnectedAppProxy> PipedreamLinearConnections<Store, Proxy> {
    /// One account budget is shared by concurrent imports. One request per
    /// second stays below the OAuth hourly budget; issues include only the
    /// first ten comments and labels, with remaining pages fetched separately.
    pub fn new(store: Arc<Store>, proxy: Option<Arc<Proxy>>) -> Self {
        Self(Connections::new(
            store,
            proxy,
            "linear",
            Duration::from_secs(1),
        ))
    }
}

#[async_trait]
impl<Store: ConnectionStore, Proxy: ConnectedAppProxy> TrackerConnections
    for PipedreamLinearConnections<Store, Proxy>
{
    #[tracing::instrument(skip_all, err)]
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(usize, usize) + Send + Sync),
    ) -> Result<Inventory, TrackerError> {
        let client = Client::new(self.0.open(user).await?);
        let mut inventory = Inventory::default();
        for (read, kind) in [
            (LinearRead::Teams, GroupKind::Team),
            (LinearRead::Projects, GroupKind::Project),
            (LinearRead::Initiatives, GroupKind::Initiative),
        ] {
            let groups: Vec<WireGroup> = match client.all(read, None).await {
                Ok(groups) => groups,
                Err(error)
                    if matches!(read, LinearRead::Initiatives) && optional_unavailable(&error) =>
                {
                    inventory
                        .warnings
                        .push("Initiatives are unavailable to this connection.".into());
                    continue;
                }
                Err(error) => return Err(error),
            };
            inventory
                .groups
                .extend(groups.into_iter().map(|group| Group {
                    id: group.id,
                    title: group.name,
                    kind,
                    parent: group.parent_initiative.map(|p| p.id),
                    url: group.url,
                    description: group.description,
                }));
            progress(0, inventory.groups.len());
        }
        if inventory
            .groups
            .iter()
            .any(|group| group.kind == GroupKind::Initiative)
        {
            for link in client
                .all::<WireLink>(LinearRead::InitiativeProjects, None)
                .await?
            {
                if let Some(project) = inventory
                    .groups
                    .iter_mut()
                    .find(|group| group.id == link.project.id)
                {
                    project.parent = Some(link.initiative.id);
                }
            }
        }
        inventory.users = client.all(LinearRead::Users, None).await?;
        inventory.cycles = client
            .all::<WireCycle>(LinearRead::Cycles, None)
            .await?
            .into_iter()
            .map(|cycle| Cycle {
                id: cycle.id,
                name: cycle
                    .name
                    .unwrap_or_else(|| format!("Cycle {}", cycle.number)),
                team: cycle.team.id,
            })
            .collect();
        for issue in client.all::<WireIssue>(LinearRead::Issues, None).await? {
            let mut comments = issue.comments.nodes;
            if issue.comments.page_info.has_next_page {
                let cursor = issue
                    .comments
                    .page_info
                    .end_cursor
                    .ok_or_else(|| TrackerError::Decode("missing comment cursor".into()))?;
                comments.extend(
                    client
                        .all_after::<WireComment>(
                            LinearRead::Comments,
                            Some(&issue.id),
                            Some(cursor),
                        )
                        .await?,
                );
            }
            let mut labels = issue.labels.nodes;
            if issue.labels.page_info.has_next_page {
                let cursor = issue
                    .labels
                    .page_info
                    .end_cursor
                    .ok_or_else(|| TrackerError::Decode("missing label cursor".into()))?;
                labels.extend(
                    client
                        .all_after::<WireLabel>(LinearRead::Labels, Some(&issue.id), Some(cursor))
                        .await?,
                );
            }
            inventory.issues.push(Issue {
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description.unwrap_or_default(),
                status: issue.state.name,
                status_category: issue.state.kind,
                issue_type: None,
                priority: match issue.priority {
                    1 => Some("Urgent"),
                    2 => Some("High"),
                    3 => Some("Medium"),
                    4 => Some("Low"),
                    _ => None,
                }
                .map(str::to_string),
                assignee_email: issue.assignee.and_then(|u| u.email),
                due_date: issue.due_date,
                labels: labels.into_iter().map(|label| label.name).collect(),
                estimate: issue.estimate,
                parent: issue.parent.map(|p| p.id),
                group: issue.project.map(|p| p.id),
                team: Some(issue.team.id),
                cycle: issue.cycle.map(|p| p.id),
                url: issue.url,
                comments: comments
                    .into_iter()
                    .map(|comment| Comment {
                        id: comment.id,
                        author: comment
                            .user
                            .map(|u| u.name)
                            .unwrap_or_else(|| "Unknown author".into()),
                        body: comment.body,
                        created_at: Some(comment.created_at),
                    })
                    .collect(),
            });
            progress(inventory.issues.len(), inventory.groups.len());
        }
        inventory.warnings.extend(
            client
                .warnings
                .into_inner()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        Ok(inventory)
    }
}

fn optional_unavailable(error: &TrackerError) -> bool {
    matches!(error, TrackerError::Forbidden(_))
        || matches!(error, TrackerError::Upstream { message, .. } if message.contains("Cannot query field") || message.contains("not enabled") || message.contains("permission"))
}

struct Client<Proxy> {
    session: Session<Proxy>,
    warnings: std::sync::Mutex<Vec<String>>,
}

impl<Proxy: ConnectedAppProxy> Client<Proxy> {
    fn new(session: Session<Proxy>) -> Self {
        Self {
            session,
            warnings: Default::default(),
        }
    }

    async fn all<T: DeserializeOwned>(
        &self,
        read: LinearRead,
        id: Option<&ObjectId>,
    ) -> Result<Vec<T>, TrackerError> {
        self.all_after(read, id, None).await
    }

    async fn all_after<T: DeserializeOwned>(
        &self,
        read: LinearRead,
        id: Option<&ObjectId>,
        mut after: Option<String>,
    ) -> Result<Vec<T>, TrackerError> {
        let mut result = Vec::new();
        let mut seen: HashSet<String> = after.iter().cloned().collect();
        loop {
            let value = self
                .session
                .read(
                    Method::POST,
                    "https://api.linear.app/graphql",
                    Some(&json!({
                        "query": read.query(), "variables": {"after": after, "id": id},
                    })),
                )
                .await?;
            if let Some(errors) = value
                .get("errors")
                .and_then(Value::as_array)
                .filter(|errors| !errors.is_empty())
            {
                return Err(TrackerError::Upstream {
                    status: 200,
                    message: errors
                        .iter()
                        .filter_map(|e| e.get("message").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("; ")
                        .chars()
                        .take(500)
                        .collect(),
                });
            }
            let data = &value["data"];
            let data = if id.is_some() { &data["issue"] } else { data };
            let page: Page<Value> = serde_json::from_value(data[read.field()].clone())
                .map_err(|error| TrackerError::Decode(error.to_string()))?;
            for node in page.nodes {
                match serde_json::from_value::<T>(node) {
                    Ok(node) => result.push(node),
                    Err(error) => self
                        .warnings
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(
                            format!(
                                "Skipped an unreadable Linear {} object: {error}",
                                read.field()
                            )
                            .chars()
                            .take(500)
                            .collect(),
                        ),
                }
            }
            if !page.page_info.has_next_page {
                return Ok(result);
            }
            let next = page
                .page_info
                .end_cursor
                .filter(|cursor| !cursor.is_empty())
                .ok_or_else(|| TrackerError::Decode("missing Linear endCursor".into()))?;
            if !seen.insert(next.clone()) {
                return Err(TrackerError::Decode("Linear cursor repeated".into()));
            }
            after = Some(next);
        }
    }
}
