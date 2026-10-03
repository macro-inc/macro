//! Initiative service implementation.

#[cfg(test)]
mod test;

use crate::domain::events::{
    InitiativeChange, InitiativeEventPublisher, InitiativeMacroEvent, InitiativeTopicEvent,
    receipt_attribution,
};
use chrono::Utc;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;

mod reads;

use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    EntityType, OwnerAccessLevel, ViewAccessLevel,
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
    CreateInitiativeRepoArgs, CreateInitiativeRequest, InitiativeBasic, InitiativeDetail,
    InitiativeError, InitiativeId, InitiativeList, MAX_INITIATIVE_DESCRIPTION_GRAPHEMES,
    MAX_INITIATIVE_NAME_GRAPHEMES, UpdateInitiativeRepoArgs, UpdateInitiativeRequest,
};
use crate::domain::ports::{InitiativeDescriptionSurfaces, InitiativeRepo, InitiativeService};
use crate::domain::resources::InitiativeResources;

/// Concrete initiative service backed by an [`InitiativeRepo`] and the description surface
/// port.
#[derive(Clone)]
pub struct InitiativeServiceImpl<R, S> {
    repo: R,
    description_surfaces: S,
    resources: Arc<dyn InitiativeResources>,
    events: Option<Arc<dyn InitiativeEventPublisher>>,
}

impl<R, S> std::fmt::Debug for InitiativeServiceImpl<R, S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InitiativeServiceImpl")
    }
}

impl<R, S> InitiativeServiceImpl<R, S>
where
    R: InitiativeRepo,
    S: InitiativeDescriptionSurfaces,
{
    /// Create an initiative service backed by the provided repository and description port.
    pub fn new(repo: R, description_surfaces: S, resources: Arc<dyn InitiativeResources>) -> Self {
        Self {
            repo,
            description_surfaces,
            resources,
            events: None,
        }
    }

    /// Attach the host's shared initiative event publisher.
    pub fn with_event_publisher(mut self, publisher: Arc<dyn InitiativeEventPublisher>) -> Self {
        self.events = Some(publisher);
        self
    }

    async fn publish(&self, id: InitiativeId, event: InitiativeTopicEvent) {
        if let Some(publisher) = &self.events
            && let Err(error) = publisher
                .publish(InitiativeMacroEvent::new(id, event))
                .await
        {
            // The write has committed. Returning an error would invite a duplicate mutation.
            tracing::error!(?error, %id, "failed to publish committed initiative event");
        }
    }

    /// Retire the description surface of an initiative that never came to exist.
    async fn retire_description(&self, id: InitiativeId) {
        if let Err(error) = self.description_surfaces.delete(id).await {
            tracing::error!(?error, %id, "description surface orphaned after failed initiative create");
        }
    }

    /// Authorize one team-share edit against the initiative's canonical facts.
    async fn authorize_team_share(
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
        .map_err(team_share_error)?
        .ok_or_else(missing_team_share_command)
        .map(Some)
    }
}

fn missing_team_share_command() -> InitiativeError {
    InitiativeError::Internal(rootcause::report!(
        "team-share authorization produced no command for a supplied request"
    ))
}

impl<R, S> InitiativeService for InitiativeServiceImpl<R, S>
where
    R: InitiativeRepo,
    R::Err: Into<InitiativeError>,
    S: InitiativeDescriptionSurfaces,
{
    async fn summary(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<crate::domain::reads::InitiativePageRow, InitiativeError> {
        self.read_summary(receipt).await
    }

    async fn page(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: crate::domain::reads::InitiativePageRequest,
    ) -> Result<crate::domain::reads::InitiativePage, InitiativeError> {
        self.read_page(user_id, request).await
    }

    async fn tasks_page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: crate::domain::reads::InitiativeTasksRequest,
    ) -> Result<crate::domain::reads::InitiativeTasksPage, InitiativeError> {
        self.read_tasks_page(receipt, request).await
    }

    /// A seeded description surface commits before the initiative row. A failed create
    /// retires it, and a failed property initialization deletes the new initiative.
    #[tracing::instrument(err, skip_all)]
    async fn create(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        self.create_attributed(
            user_id,
            request,
            activity::Attribution::direct(activity::Actor::new_from_user(
                user_id.clone().into_owned(),
            )),
        )
        .await
    }

    #[tracing::instrument(err, skip_all)]
    async fn create_attributed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
        attribution: activity::Attribution,
    ) -> Result<InitiativeDetail, InitiativeError> {
        let authorized = match &attribution {
            activity::Attribution::Direct { actor } => {
                actor.as_user().is_some_and(|actor| actor == user_id)
            }
            activity::Attribution::Delegated { actor, subject } => {
                actor.as_bot().is_some() && subject == user_id
            }
        };
        if !authorized {
            return Err(InitiativeError::Unauthorized);
        }
        let name = normalize_name(&request.name)?;
        let prefill_markdown = normalize_description(request.description)?;
        let owner_id = user_id.clone().into_owned();
        let member_ids = parse_member_ids(request.member_ids.unwrap_or_default(), &owner_id)?;
        let property_values = validate_initial_properties(request.property_values)?;
        let team_default = self
            .repo
            .get_team_default_link_share(&owner_id)
            .await
            .map_err(Into::into)?;
        let share_permission = SharePermissionV2::new_initiative_share_permission(team_default);
        let team_share = if request.share_with_team.unwrap_or(true) {
            TeamShareCreation::Initiative
        } else {
            TeamShareCreation::Unshared
        };

        let id = InitiativeId::generate();
        // A description given at creation seeds the surface before the row exists, so the
        // project never opens without it. Otherwise the surface is ensured on first open.
        let seeded = !prefill_markdown.is_empty();
        if seeded {
            self.description_surfaces
                .ensure(id, prefill_markdown)
                .await?;
        }
        let created = self
            .repo
            .create(
                CreateInitiativeRepoArgs {
                    id,
                    owner_id,
                    name,
                    member_ids,
                },
                share_permission,
                team_share,
            )
            .await;
        let mut detail = match created {
            Ok(detail) => detail,
            Err(error) => {
                if seeded {
                    self.retire_description(id).await;
                }
                return Err(error.into());
            }
        };
        if let Err(error) = initialize_properties(
            self.resources.as_ref(),
            user_id.clone().into_owned(),
            id,
            property_values,
        )
        .await
        {
            if self
                .repo
                .delete(id)
                .await
                .inspect_err(|cleanup| {
                    tracing::error!(error=?cleanup, %id, "failed to compensate initiative initialization");
                })
                .is_ok()
            {
                self.publish(id, InitiativeTopicEvent::Purged { initiative_id: id })
                    .await;
                self.retire_description(id).await;
            }
            return Err(error);
        }
        detail.user_access_level = AccessLevel::Owner;
        self.publish(
            id,
            InitiativeTopicEvent::Created(InitiativeChange {
                initiative_id: id,
                attribution: Some(attribution.into()),
                occurred_at: Utc::now(),
            }),
        )
        .await;
        Ok(detail)
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
        let mut detail = self
            .repo
            .get_detail(id)
            .await
            .map_err(Into::into)?
            .ok_or(InitiativeError::NotFound)?;
        detail.user_access_level = receipt_access_level(&receipt)?;
        detail.task_ids = self
            .visible_tasks(receipt.auth(), self.resources.project_tasks(id).await?)
            .await?;
        Ok(detail)
    }

    #[tracing::instrument(err, skip_all)]
    async fn ensure_description_surface(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<(), InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        // An existing surface keeps its content; a project's first open starts it empty.
        self.description_surfaces.ensure(id, String::new()).await
    }

    #[tracing::instrument(err, skip_all)]
    async fn read_description(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        self.description_surfaces.read(id).await
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
        if (request.share_permission.is_some() || request.member_ids.is_some())
            && !receipt_is_owner(&receipt)
        {
            return Err(InitiativeError::Unauthorized);
        }

        let name = request.name.as_deref().map(normalize_name).transpose()?;

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
            self.authorize_team_share(
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

        let mut detail = self
            .repo
            .update(UpdateInitiativeRepoArgs {
                id,
                name,
                member_ids_added,
                member_ids_removed,
                share_permission: request.share_permission,
                team_share,
            })
            .await
            .map_err(Into::into)?;
        self.publish(
            id,
            InitiativeTopicEvent::Updated(InitiativeChange {
                initiative_id: id,
                attribution: receipt_attribution(&receipt),
                occurred_at: Utc::now(),
            }),
        )
        .await;
        detail.user_access_level = receipt_access_level(&receipt)?;
        detail.task_ids = self
            .visible_tasks(receipt.auth(), self.resources.project_tasks(id).await?)
            .await?;
        Ok(detail)
    }

    #[tracing::instrument(err, skip_all)]
    async fn grant_assignees(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), InitiativeError> {
        super::assignees::grant(&self.repo, &receipt, user_ids).await
    }

    /// Initiative rows first, then the description. The document FK's `ON DELETE RESTRICT`
    /// would reject a document-first purge while the initiative still names it. Purging the
    /// document drops its sync-service session, which the surface adopted; the surface row
    /// is then soft-deleted so no token outlives the initiative.
    #[tracing::instrument(err, skip_all)]
    async fn delete(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), InitiativeError> {
        let id = initiative_id_from_receipt(&receipt)?;
        self.repo.delete(id).await.map_err(Into::into)?;
        self.publish(id, InitiativeTopicEvent::Purged { initiative_id: id })
            .await;
        // Cleanup follows an authorized deletion and is not a fresh user edit.
        // Unattributed property cleanup cannot recreate history after the purge event.
        let cleanup_receipt = EntityAccessReceipt::try_new(
            EntityAccessAuth::Internal,
            receipt.entity().clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
        .map_err(|_| InitiativeError::Unauthorized)?;
        let properties_cleanup = self.resources.purge(cleanup_receipt).await;
        let surface_cleanup = self.description_surfaces.delete(id).await.inspect_err(|error| {
            tracing::error!(?error, %id, "description surface orphaned after initiative delete");
        });
        properties_cleanup.and(surface_cleanup)
    }
}

fn team_share_error(error: TeamSharePolicyError) -> InitiativeError {
    match error {
        TeamSharePolicyError::MissingActor | TeamSharePolicyError::NotOwner => {
            InitiativeError::Unauthorized
        }
        TeamSharePolicyError::InvalidRevision => InitiativeError::Conflict(error.to_string()),
        TeamSharePolicyError::MissingTeam
        | TeamSharePolicyError::InvalidLevel
        | TeamSharePolicyError::ContradictoryInputs => {
            InitiativeError::BadRequest(error.to_string())
        }
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

pub(super) fn initiative_id_from_receipt<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<InitiativeId, InitiativeError> {
    if receipt.entity().entity_type != EntityType::Initiative {
        return Err(InitiativeError::BadRequest(
            "requires an initiative access receipt".to_string(),
        ));
    }
    InitiativeId::from_str(&receipt.entity().entity_id)
        .map_err(|_| InitiativeError::BadRequest("invalid initiative id".to_string()))
}

fn receipt_access_level<T: entity_access::domain::models::RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<AccessLevel, InitiativeError> {
    match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => Ok(*access_level),
        _ => Err(InitiativeError::Unauthorized),
    }
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

fn normalize_description(description: Option<String>) -> Result<String, InitiativeError> {
    let description = description.as_deref().unwrap_or_default().trim();
    if description.graphemes(true).count() > MAX_INITIATIVE_DESCRIPTION_GRAPHEMES {
        return Err(InitiativeError::BadRequest(format!(
            "description must be at most {MAX_INITIATIVE_DESCRIPTION_GRAPHEMES} graphemes"
        )));
    }
    Ok(description.to_string())
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

/// More than any project form sends; bounds the writes one create can fan out to.
const MAX_INITIAL_PROPERTY_VALUES: usize = 32;

/// Rejected before anything is created, so a bad request never needs compensation.
fn validate_initial_properties(
    values: Vec<crate::domain::models::InitialPropertyValue>,
) -> Result<Vec<crate::domain::models::InitialPropertyValue>, InitiativeError> {
    if values.len() > MAX_INITIAL_PROPERTY_VALUES {
        return Err(InitiativeError::BadRequest(format!(
            "at most {MAX_INITIAL_PROPERTY_VALUES} initial property values are allowed"
        )));
    }
    let mut seen = HashSet::new();
    if let Some(duplicate) = values
        .iter()
        .find(|value| !seen.insert(value.property_definition_id))
    {
        return Err(InitiativeError::BadRequest(format!(
            "property {} is set more than once",
            duplicate.property_definition_id
        )));
    }
    Ok(values)
}

/// Attach the canonical properties, then set the owner's first values. Either
/// failing fails the create, which then deletes the initiative.
async fn initialize_properties(
    resources: &dyn InitiativeResources,
    owner: MacroUserIdStr<'static>,
    id: InitiativeId,
    values: Vec<crate::domain::models::InitialPropertyValue>,
) -> Result<(), InitiativeError> {
    resources.initialize(id).await?;
    resources.set_initial_properties(owner, id, values).await
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
