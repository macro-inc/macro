//! Read-use-case policy, pagination and visibility.

use std::{cmp::Ordering, collections::HashMap};

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    Entity, EntityAccessAuth, EntityAccessReceipt, EntityType, ViewAccessLevel,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};

use super::{InitiativeServiceImpl, receipt_access_level};
use crate::domain::{
    models::{InitiativeError, InitiativeId, MAX_TASKS_PER_ASSIGN},
    ports::{InitiativeDescriptionDocuments, InitiativeRepo, InitiativeService},
    reads::{
        InitiativePage, InitiativePageRequest, InitiativePageRow, InitiativeReference,
        InitiativeSort, InitiativeTasksPage, InitiativeTasksRequest, TaskInitiativeReference,
        TaskInitiativeReferences, TaskInitiativeReferencesRequest,
    },
};

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 100;
const MAX_CURSOR_LENGTH: usize = 2048;

#[derive(Serialize, Deserialize)]
struct Position {
    id: InitiativeId,
    name: String,
    updated_at: DateTime<Utc>,
    due_date: Option<DateTime<Utc>>,
}

impl From<&InitiativePageRow> for Position {
    fn from(row: &InitiativePageRow) -> Self {
        Self {
            id: row.initiative.id,
            name: row.initiative.name.to_lowercase(),
            updated_at: row.initiative.updated_at,
            due_date: row.properties.due_date,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Cursor {
    sort: InitiativeSort,
    descending: bool,
    position: Position,
}

fn limit(limit: Option<u16>) -> Result<usize, InitiativeError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(InitiativeError::BadRequest(
            "limit must be between 1 and 100".into(),
        ));
    }
    Ok(usize::from(limit))
}

fn order(left: &Position, right: &Position, sort: InitiativeSort, descending: bool) -> Ordering {
    if sort == InitiativeSort::Due {
        match (left.due_date, right.due_date) {
            (None, Some(_)) => return Ordering::Greater,
            (Some(_), None) => return Ordering::Less,
            _ => (),
        }
    }
    let order = match sort {
        InitiativeSort::Updated => left.updated_at.cmp(&right.updated_at),
        InitiativeSort::Name => left.name.cmp(&right.name),
        InitiativeSort::Due => left.due_date.cmp(&right.due_date),
    }
    .then_with(|| left.id.as_uuid().cmp(&right.id.as_uuid()));
    if descending { order.reverse() } else { order }
}

impl<R: InitiativeRepo, D: InitiativeDescriptionDocuments> InitiativeServiceImpl<R, D> {
    pub(super) async fn read_summary(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<InitiativePageRow, InitiativeError> {
        let detail = self.get(receipt.clone()).await?;
        let mut receipts = vec![receipt.clone()];
        for task_id in &detail.task_ids {
            if let Some(task_receipt) = self
                .resources
                .view(
                    receipt.auth().clone(),
                    Entity {
                        entity_id: task_id.clone(),
                        entity_type: EntityType::Document,
                    },
                )
                .await?
            {
                receipts.push(task_receipt);
            }
        }
        let mut properties = self.resources.properties(receipts.clone()).await?;
        let task_count = receipts.len().saturating_sub(1);
        let completed_task_count = receipts
            .iter()
            .skip(1)
            .filter(|task| {
                properties
                    .get(&task.entity().entity_id)
                    .is_some_and(|value| value.completed)
            })
            .count();
        Ok(InitiativePageRow {
            initiative: crate::domain::models::InitiativeSummary {
                id: detail.id,
                name: detail.name,
                description_document_id: detail.description_document_id,
                updated_at: detail.updated_at,
            },
            user_access_level: detail.user_access_level,
            properties: properties
                .remove(&detail.id.to_string())
                .unwrap_or_default(),
            task_count: u32::try_from(task_count).unwrap_or(u32::MAX),
            completed_task_count: u32::try_from(completed_task_count).unwrap_or(u32::MAX),
        })
    }

    pub(super) async fn visible_tasks(
        &self,
        auth: &EntityAccessAuth,
        ids: Vec<String>,
    ) -> Result<Vec<String>, InitiativeError> {
        let mut visible = Vec::new();
        for id in ids {
            if self
                .resources
                .view(
                    auth.clone(),
                    Entity {
                        entity_id: id.clone(),
                        entity_type: EntityType::Document,
                    },
                )
                .await?
                .is_some()
            {
                visible.push(id);
            }
        }
        Ok(visible)
    }

    pub(super) async fn read_page(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: InitiativePageRequest,
    ) -> Result<InitiativePage, InitiativeError> {
        let size = limit(request.limit)?;
        if request
            .query
            .as_ref()
            .is_some_and(|query| query.len() > 400)
        {
            return Err(InitiativeError::BadRequest("search query too long".into()));
        }
        if matches!((request.due_after, request.due_before), (Some(after), Some(before)) if after > before)
        {
            return Err(InitiativeError::BadRequest(
                "dueAfter must precede dueBefore".into(),
            ));
        }
        let descending = request
            .descending
            .unwrap_or(request.sort == InitiativeSort::Updated);
        let cursor: Option<Cursor> = request
            .cursor
            .as_ref()
            .map(|cursor| {
                if cursor.len() > MAX_CURSOR_LENGTH {
                    return Err(InitiativeError::BadRequest("invalid cursor".into()));
                }
                serde_json::from_str(cursor)
                    .map_err(|_| InitiativeError::BadRequest("invalid cursor".into()))
            })
            .transpose()?;
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor.sort != request.sort || cursor.descending != descending)
        {
            return Err(InitiativeError::BadRequest(
                "cursor ordering differs from request".into(),
            ));
        }
        let auth = EntityAccessAuth::Authenticated(user_id.clone().into_owned());
        let query = request.query.as_deref().unwrap_or("").trim().to_lowercase();
        let candidates = self
            .repo
            .list_accessible(&user_id.clone().into_owned())
            .await
            .map_err(Into::into)?;
        let mut authorized = Vec::new();
        for project in candidates.initiatives {
            if !project.name.to_lowercase().contains(&query) {
                continue;
            }
            if let Some(receipt) = self
                .resources
                .view(
                    auth.clone(),
                    Entity {
                        entity_id: project.id.to_string(),
                        entity_type: EntityType::Initiative,
                    },
                )
                .await?
            {
                authorized.push((project, receipt));
            }
        }
        let mut properties = self
            .resources
            .properties(
                authorized
                    .iter()
                    .map(|(_, receipt)| receipt.clone())
                    .collect(),
            )
            .await?;
        let mut rows = Vec::new();
        for (initiative, receipt) in authorized {
            let values = properties
                .remove(&initiative.id.to_string())
                .unwrap_or_default();
            if request
                .status
                .is_some_and(|status| values.status != Some(status))
                || request
                    .priority
                    .is_some_and(|priority| values.priority != Some(priority))
                || request
                    .assignee
                    .as_ref()
                    .is_some_and(|id| !values.assignees.contains(id))
                || request
                    .due_after
                    .is_some_and(|date| values.due_date.is_none_or(|due| due < date))
                || request
                    .due_before
                    .is_some_and(|date| values.due_date.is_none_or(|due| due > date))
            {
                continue;
            }
            rows.push(InitiativePageRow {
                initiative,
                user_access_level: receipt_access_level(&receipt)?,
                properties: values,
                task_count: 0,
                completed_task_count: 0,
            });
        }
        rows.sort_by(|left, right| order(&left.into(), &right.into(), request.sort, descending));
        if let Some(cursor) = cursor {
            rows.retain(|row| {
                order(&row.into(), &cursor.position, request.sort, descending) == Ordering::Greater
            });
        }
        let has_more = rows.len() > size;
        rows.truncate(size);
        let next_cursor = if has_more {
            rows.last()
                .map(|last| {
                    serde_json::to_string(&Cursor {
                        sort: request.sort,
                        descending,
                        position: last.into(),
                    })
                    .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
                })
                .transpose()?
        } else {
            None
        };
        // Hydrate progress only for the selected page, using current task access.
        let mut tasks_by_project = HashMap::new();
        let mut task_receipts = Vec::new();
        for row in &rows {
            let Some(detail) = self
                .repo
                .get_detail(row.initiative.id)
                .await
                .map_err(Into::into)?
            else {
                continue;
            };
            let mut ids = Vec::new();
            for id in detail.task_ids {
                if let Some(receipt) = self
                    .resources
                    .view(
                        auth.clone(),
                        Entity {
                            entity_id: id.clone(),
                            entity_type: EntityType::Document,
                        },
                    )
                    .await?
                {
                    ids.push(id);
                    task_receipts.push(receipt);
                }
            }
            tasks_by_project.insert(row.initiative.id, ids);
        }
        let task_properties = self.resources.properties(task_receipts).await?;
        for row in &mut rows {
            if let Some(ids) = tasks_by_project.get(&row.initiative.id) {
                row.task_count = u32::try_from(ids.len()).unwrap_or(u32::MAX);
                row.completed_task_count = u32::try_from(
                    ids.iter()
                        .filter(|id| {
                            task_properties
                                .get(*id)
                                .is_some_and(|properties| properties.completed)
                        })
                        .count(),
                )
                .unwrap_or(u32::MAX);
            }
        }
        Ok(InitiativePage {
            initiatives: rows,
            next_cursor,
        })
    }

    pub(super) async fn read_tasks_page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: InitiativeTasksRequest,
    ) -> Result<InitiativeTasksPage, InitiativeError> {
        let size = limit(request.limit)?;
        if request
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > MAX_CURSOR_LENGTH)
        {
            return Err(InitiativeError::BadRequest("invalid cursor".into()));
        }
        let mut ids = self.get(receipt).await?.task_ids;
        ids.sort();
        let total = u32::try_from(ids.len()).unwrap_or(u32::MAX);
        if let Some(cursor) = request.cursor {
            ids.retain(|id| id > &cursor);
        }
        let has_more = ids.len() > size;
        ids.truncate(size);
        let next_cursor = has_more.then(|| ids.last().cloned()).flatten();
        Ok(InitiativeTasksPage {
            task_ids: ids,
            next_cursor,
            total,
        })
    }

    pub(super) async fn read_task_references(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: TaskInitiativeReferencesRequest,
    ) -> Result<TaskInitiativeReferences, InitiativeError> {
        let mut seen = std::collections::HashSet::new();
        let mut ids = Vec::new();
        for id in request.task_ids {
            if id.is_empty() || id.len() > 128 {
                return Err(InitiativeError::BadRequest("invalid task id".into()));
            }
            if seen.insert(id.clone()) {
                if ids.len() == MAX_TASKS_PER_ASSIGN {
                    return Err(InitiativeError::BadRequest(
                        "at most 100 task ids are allowed".into(),
                    ));
                }
                ids.push(id);
            }
        }
        let auth = EntityAccessAuth::Authenticated(user_id.clone().into_owned());
        let visible = self.visible_tasks(&auth, ids.clone()).await?;
        let memberships = self
            .repo
            .task_memberships(visible.clone())
            .await
            .map_err(Into::into)?;
        let mut projects = HashMap::new();
        for id in memberships.values() {
            if projects.contains_key(id) {
                continue;
            }
            let basic = if self
                .resources
                .view(
                    auth.clone(),
                    Entity {
                        entity_id: id.to_string(),
                        entity_type: EntityType::Initiative,
                    },
                )
                .await?
                .is_some()
            {
                self.repo.get_basic(*id).await.map_err(Into::into)?
            } else {
                None
            };
            projects.insert(*id, basic);
        }
        let references = ids
            .into_iter()
            .map(|task_id| {
                if !visible.contains(&task_id) {
                    return TaskInitiativeReference::Unavailable { task_id };
                }
                match memberships.get(&task_id) {
                    None => TaskInitiativeReference::None { task_id },
                    Some(id) => match projects.get(id).and_then(Option::as_ref) {
                        Some(project) => TaskInitiativeReference::Visible {
                            task_id,
                            initiative: InitiativeReference {
                                id: *id,
                                name: project.name.clone(),
                            },
                        },
                        None => TaskInitiativeReference::Unavailable { task_id },
                    },
                }
            })
            .collect();
        Ok(TaskInitiativeReferences { references })
    }
}
