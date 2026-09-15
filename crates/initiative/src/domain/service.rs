//! Initiative service implementation.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, EntityPermission, EntityType,
    OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareCreation, TeamShareLevel, TeamSharePolicyError,
    TeamShareRequest, authorize_team_share,
};
use unicode_segmentation::UnicodeSegmentation;

use crate::domain::models::{
    AssignTaskStatus, AssignTasksResponse, AssignTasksResult, CreateInitiativeRepoArgs,
    CreateInitiativeRequest, InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId,
    InitiativeList, MAX_INITIATIVE_DESCRIPTION_GRAPHEMES, MAX_INITIATIVE_NAME_GRAPHEMES,
    MAX_TASKS_PER_ASSIGN, TaskAssignment, UpdateInitiativeRepoArgs, UpdateInitiativeRequest,
};
use crate::domain::ports::{InitiativeRepo, InitiativeService};

/// Concrete initiative service backed by an [`InitiativeRepo`].
#[derive(Debug, Clone)]
pub struct InitiativeServiceImpl<R> {
    repo: R,
}

impl<R> InitiativeServiceImpl<R>
where
    R: InitiativeRepo,
{
    /// Create an initiative service backed by the provided repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    async fn authorize_initiative_team_share(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        request: TeamShareRequest,
    ) -> Result<Option<AuthorizedTeamShareCommand>, InitiativeError> {
        if request == TeamShareRequest::default() {
            return Ok(None);
        }
        let id = initiative_id_from_receipt(receipt)?;
        let facts = self
            .repo
            .get_team_share_facts(id)
            .await
            .map_err(Into::into)?;
        authorize_team_share(
            receipt.acting_user_id(),
            &facts,
            request,
            TeamShareLevel::Edit,
        )
        .map_err(|error| match error {
            TeamSharePolicyError::MissingActor | TeamSharePolicyError::NotOwner => {
                InitiativeError::Unauthorized
            }
            TeamSharePolicyError::InvalidRevision => InitiativeError::Conflict(error.to_string()),
            _ => InitiativeError::BadRequest(error.to_string()),
        })
    }
}

impl<R> InitiativeService for InitiativeServiceImpl<R>
where
    R: InitiativeRepo,
    R::Err: Into<InitiativeError>,
{
    #[tracing::instrument(err, skip_all)]
    async fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        let name = normalize_name(&request.name)?;
        let description = normalize_description(request.description)?;
        let owner_id = user_id.clone().into_owned();
        let member_ids = parse_member_ids(request.member_ids.unwrap_or_default(), &owner_id)?;
        let team_default = self
            .repo
            .get_team_default_link_share(&owner_id)
            .await
            .map_err(Into::into)?;
        let share_permission = SharePermissionV2::new_initiative_share_permission(team_default);
        let team_share = if request.share_with_team == Some(true) {
            TeamShareCreation::Initiative
        } else {
            TeamShareCreation::Unshared
        };
        self.repo
            .create(
                CreateInitiativeRepoArgs {
                    id: InitiativeId::generate(),
                    owner_id,
                    name,
                    description,
                    member_ids,
                },
                share_permission,
                team_share,
            )
            .await
            .map_err(Into::into)
    }

    #[tracing::instrument(err, skip_all)]
    async fn internal_get_basic(
        &self,
        id: InitiativeId,
    ) -> Result<InitiativeBasic, InitiativeError> {
        self.repo
            .get_basic(id)
            .await
            .map_err(Into::into)?
            .ok_or(InitiativeError::NotFound)
    }

    #[tracing::instrument(err, skip_all)]
    async fn get(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<InitiativeDetail, InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        self.repo
            .get_detail(id)
            .await
            .map_err(Into::into)?
            .ok_or(InitiativeError::NotFound)
    }

    #[tracing::instrument(err, skip_all)]
    async fn list(&self, user_id: &MacroUserIdStr<'_>) -> Result<InitiativeList, InitiativeError> {
        let user_id = user_id.clone().into_owned();
        self.repo
            .list_accessible(&user_id)
            .await
            .map_err(Into::into)
    }

    #[tracing::instrument(err, skip_all)]
    async fn update(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        if request.share_permission.is_some() && !receipt_is_owner(&receipt) {
            return Err(InitiativeError::Unauthorized);
        }

        let name = request.name.as_deref().map(normalize_name).transpose()?;
        let description = match request.description {
            None => None,
            Some(value) => Some(normalize_description(Some(value))?),
        };

        let id = initiative_id_from_receipt(&receipt)?;
        let (member_ids_added, member_ids_removed) = if let Some(member_ids) = request.member_ids {
            let current = self
                .repo
                .get_detail(id)
                .await
                .map_err(Into::into)?
                .ok_or(InitiativeError::NotFound)?;
            let requested = parse_member_ids(member_ids, &current.owner_id)?;
            member_diff(&current.member_ids, &requested)
        } else {
            (Vec::new(), Vec::new())
        };

        let team_share = if let Some(share_permission) = request.share_permission.as_ref() {
            self.authorize_initiative_team_share(
                &receipt,
                TeamShareRequest {
                    access_level: share_permission.team_share_access_level,
                    legacy_enabled: None,
                },
            )
            .await?
        } else {
            None
        };

        self.repo
            .update(UpdateInitiativeRepoArgs {
                id,
                name,
                description,
                member_ids_added,
                member_ids_removed,
                share_permission: request.share_permission,
                team_share,
            })
            .await
            .map_err(Into::into)
    }

    #[tracing::instrument(err, skip_all)]
    async fn assign_tasks(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        assignments: Vec<TaskAssignment>,
    ) -> Result<AssignTasksResponse, InitiativeError> {
        if receipt.entity().entity_type != EntityType::Initiative {
            return Err(InitiativeError::BadRequest(
                "assign_tasks requires an initiative access receipt".to_string(),
            ));
        }

        let assignments = dedupe_assignments(assignments);
        if assignments.len() > MAX_TASKS_PER_ASSIGN {
            return Err(InitiativeError::BadRequest(format!(
                "cannot assign more than {MAX_TASKS_PER_ASSIGN} tasks at once"
            )));
        }

        let id = initiative_id_from_receipt(&receipt)?;
        let candidate_ids: Vec<String> = assignments
            .iter()
            .filter_map(|assignment| match assignment {
                TaskAssignment::Candidate { task_id } => Some(task_id.clone()),
                TaskAssignment::NotFound { .. } | TaskAssignment::SkippedNoPermission { .. } => {
                    None
                }
            })
            .collect();

        let repo_results = if candidate_ids.is_empty() {
            Vec::new()
        } else {
            self.repo
                .assign_tasks(id, candidate_ids)
                .await
                .map_err(Into::into)?
        };

        Ok(AssignTasksResponse {
            results: merge_assign_results(&assignments, repo_results),
        })
    }

    #[tracing::instrument(err, skip_all)]
    async fn unassign_task(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        task_id: &str,
    ) -> Result<(), InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        self.repo
            .unassign_task(id, task_id)
            .await
            .map_err(Into::into)
    }

    #[tracing::instrument(err, skip_all)]
    async fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        self.repo.delete(id).await.map_err(Into::into)
    }
}

fn receipt_is_owner<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> bool {
    matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        }
    )
}

fn initiative_id_from_receipt<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<InitiativeId, InitiativeError> {
    InitiativeId::from_str(&receipt.entity().entity_id)
        .map_err(|_| InitiativeError::BadRequest("invalid initiative id".to_string()))
}

fn normalize_name(name: &str) -> Result<String, InitiativeError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(InitiativeError::BadRequest(
            "initiative name must not be empty".to_string(),
        ));
    }
    if name.graphemes(true).count() > MAX_INITIATIVE_NAME_GRAPHEMES {
        return Err(InitiativeError::NameTooLong {
            max: MAX_INITIATIVE_NAME_GRAPHEMES,
        });
    }
    Ok(name.to_string())
}

fn normalize_description(description: Option<String>) -> Result<Option<String>, InitiativeError> {
    let Some(description) = description else {
        return Ok(None);
    };
    let description = description.trim();
    if description.is_empty() {
        return Ok(None);
    }
    if description.graphemes(true).count() > MAX_INITIATIVE_DESCRIPTION_GRAPHEMES {
        return Err(InitiativeError::BadRequest(format!(
            "description must be at most {MAX_INITIATIVE_DESCRIPTION_GRAPHEMES} graphemes"
        )));
    }
    Ok(Some(description.to_string()))
}

fn parse_member_ids(
    member_ids: Vec<String>,
    owner: &MacroUserIdStr<'_>,
) -> Result<Vec<MacroUserIdStr<'static>>, InitiativeError> {
    let mut seen = HashSet::new();
    let mut parsed = Vec::new();
    for raw in member_ids {
        let member = MacroUserIdStr::parse_from_str(&raw)
            .map_err(|error| InitiativeError::BadRequest(error.to_string()))?
            .into_owned();
        if member.as_ref() == owner.as_ref() {
            continue;
        }
        if seen.insert(member.to_string()) {
            parsed.push(member);
        }
    }
    Ok(parsed)
}

fn member_diff(
    current: &[MacroUserIdStr<'static>],
    requested: &[MacroUserIdStr<'static>],
) -> (Vec<MacroUserIdStr<'static>>, Vec<MacroUserIdStr<'static>>) {
    let current_set: HashSet<&str> = current.iter().map(|id| id.as_ref()).collect();
    let requested_set: HashSet<&str> = requested.iter().map(|id| id.as_ref()).collect();
    let added = requested
        .iter()
        .filter(|id| !current_set.contains(id.as_ref()))
        .cloned()
        .collect();
    let removed = current
        .iter()
        .filter(|id| !requested_set.contains(id.as_ref()))
        .cloned()
        .collect();
    (added, removed)
}

fn dedupe_assignments(assignments: Vec<TaskAssignment>) -> Vec<TaskAssignment> {
    let mut seen = HashSet::new();
    assignments
        .into_iter()
        .filter(|assignment| seen.insert(assignment.task_id().to_string()))
        .collect()
}

fn merge_assign_results(
    assignments: &[TaskAssignment],
    repo_results: Vec<AssignTasksResult>,
) -> Vec<AssignTasksResult> {
    let repo_by_id: HashMap<String, AssignTaskStatus> = repo_results
        .into_iter()
        .map(|result| (result.task_id, result.status))
        .collect();
    assignments
        .iter()
        .map(|assignment| match assignment {
            TaskAssignment::Candidate { task_id } => AssignTasksResult {
                task_id: task_id.clone(),
                status: repo_by_id
                    .get(task_id)
                    .copied()
                    .unwrap_or(AssignTaskStatus::NotFound),
            },
            TaskAssignment::NotFound { task_id } => AssignTasksResult {
                task_id: task_id.clone(),
                status: AssignTaskStatus::NotFound,
            },
            TaskAssignment::SkippedNoPermission { task_id } => AssignTasksResult {
                task_id: task_id.clone(),
                status: AssignTaskStatus::SkippedNoPermission,
            },
        })
        .collect()
}
