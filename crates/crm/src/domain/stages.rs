//! Team deal stages: the role-gated write path over the team's stage definition.

use std::collections::{HashMap, HashSet};

use entity_access::domain::models::MemberTeamRole;
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::{CrmError, CrmTeamSettings, CrmTeamSettingsPatch},
};

#[cfg(test)]
mod test;

/// Name of the team-scoped stage definition; `Stage` is reserved by a trigger.
pub use properties::CRM_TEAM_STAGE_DEFINITION_NAME;

/// Maximum stages in one pipeline.
pub const MAX_STAGES: usize = 50;

/// Maximum stage label length.
pub const MAX_STAGE_LABEL_CHARS: usize = 100;

/// One stage of a team's custom pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamStage {
    /// Property option id, stored on companies as their stage value.
    pub id: Uuid,
    /// Display label.
    pub label: String,
    /// Pipeline position.
    pub display_order: i32,
}

/// A team's custom stage set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamStageSet {
    /// Team-scoped stage definition id.
    pub definition_id: Uuid,
    /// Stages in pipeline order.
    pub stages: Vec<TeamStage>,
}

/// One requested stage: an existing id to keep, or `None` to add.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageInput {
    /// Existing stage id, or `None` for a new stage.
    pub id: Option<Uuid>,
    /// Label after the update.
    pub label: String,
}

/// A stage kept through a replace, with its label and position afterwards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageRewrite {
    /// The stage to keep.
    pub id: Uuid,
    /// Label after the replace.
    pub label: String,
    /// Position after the replace.
    pub display_order: i32,
}

/// A stage added by a replace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageInsert {
    /// Label of the new stage.
    pub label: String,
    /// Position of the new stage.
    pub display_order: i32,
}

/// A whole-set change to a team's stages, applied atomically.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StageReplacePlan {
    /// Stages to remove.
    pub delete: Vec<Uuid>,
    /// Stages to keep, renamed or moved.
    pub rewrite: Vec<StageRewrite>,
    /// Stages to add.
    pub insert: Vec<StageInsert>,
}

/// Outbound port over the caller's team stage definition.
pub trait StageDefinitionStore: Send + Sync + 'static {
    /// The team's custom stage set, `None` on the system defaults.
    fn get_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<Option<TeamStageSet>, CrmError>> + Send;

    /// Create the definition with one option per label, in order, atomically.
    fn create_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        labels: &[String],
    ) -> impl Future<Output = Result<TeamStageSet, CrmError>> + Send;

    /// Apply a plan to an existing definition in one transaction.
    fn replace_stages(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        definition_id: Uuid,
        plan: StageReplacePlan,
    ) -> impl Future<Output = Result<TeamStageSet, CrmError>> + Send;

    /// Delete the definition and its options.
    fn delete_team_stage_set(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        definition_id: Uuid,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// The team's CRM settings, as the stage service needs them.
pub trait TeamSettingsStore: Send + Sync + 'static {
    /// The team's CRM settings, defaults when no row exists.
    fn read_team_settings(
        &self,
        team_id: &Uuid,
    ) -> impl Future<Output = Result<CrmTeamSettings, CrmError>> + Send;

    /// Field-wise partial update of the team's CRM settings.
    fn patch_team_settings(
        &self,
        team_id: &Uuid,
        patch: &CrmTeamSettingsPatch,
    ) -> impl Future<Output = Result<CrmTeamSettings, CrmError>> + Send;
}

/// Team stage mutations, gated on the team's `edit_stages_role`.
pub trait CrmStageService: Send + Sync + 'static {
    /// Replace the team's stage set; created on first use, diffed afterwards.
    fn replace_stages(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        stages: Vec<StageInput>,
    ) -> impl Future<Output = Result<TeamStageSet, CrmError>> + Send;

    /// Delete the custom stage set; no-op on the defaults.
    fn reset_stages(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}

/// [`CrmStageService`] over team settings and a [`StageDefinitionStore`].
#[derive(Clone, Debug)]
pub struct CrmStageServiceImpl<TS, SD> {
    team_settings: TS,
    stage_definitions: SD,
}

impl<TS, SD> CrmStageServiceImpl<TS, SD>
where
    TS: TeamSettingsStore,
    SD: StageDefinitionStore,
{
    /// Create the service.
    pub fn new(team_settings: TS, stage_definitions: SD) -> Self {
        Self {
            team_settings,
            stage_definitions,
        }
    }

    async fn require_edit_stages_role(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<CrmTeamSettings, CrmError> {
        let settings = self
            .team_settings
            .read_team_settings(&access.team_id())
            .await?;
        if access.satisfies_permission_role(settings.edit_stages_role) {
            Ok(settings)
        } else {
            Err(CrmError::StageEditRoleRequired(settings.edit_stages_role))
        }
    }

    async fn prune_closed_stage_ids(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        settings: &CrmTeamSettings,
        live: &[Uuid],
    ) -> Result<(), CrmError> {
        let Some(closed) = &settings.closed_stage_ids else {
            return Ok(());
        };
        if closed.iter().all(|id| live.contains(id)) {
            return Ok(());
        }
        let kept: Vec<Uuid> = closed
            .iter()
            .copied()
            .filter(|id| live.contains(id))
            .collect();
        self.write_closed_stage_ids(access, Some(kept)).await
    }

    async fn clear_closed_stage_ids(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        settings: &CrmTeamSettings,
    ) -> Result<(), CrmError> {
        if settings.closed_stage_ids.is_none() {
            return Ok(());
        }
        self.write_closed_stage_ids(access, None).await
    }

    async fn write_closed_stage_ids(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        closed: Option<Vec<Uuid>>,
    ) -> Result<(), CrmError> {
        let patch = CrmTeamSettingsPatch {
            closed_stage_ids: Some(closed),
            ..Default::default()
        };
        self.team_settings
            .patch_team_settings(&access.team_id(), &patch)
            .await?;
        Ok(())
    }
}

fn validate_stage_inputs(stages: Vec<StageInput>) -> Result<Vec<StageInput>, CrmError> {
    if stages.is_empty() {
        return Err(CrmError::InvalidRequest(
            "at least one stage is required".into(),
        ));
    }
    if stages.len() > MAX_STAGES {
        return Err(CrmError::InvalidRequest(format!(
            "a pipeline can have at most {MAX_STAGES} stages"
        )));
    }

    let mut seen_labels = HashSet::with_capacity(stages.len());
    let mut seen_ids = HashSet::with_capacity(stages.len());
    let mut normalized = Vec::with_capacity(stages.len());
    for stage in stages {
        let label = stage.label.trim().to_string();
        if label.is_empty() {
            return Err(CrmError::InvalidRequest(
                "stage labels must not be blank".into(),
            ));
        }
        if label.chars().count() > MAX_STAGE_LABEL_CHARS {
            return Err(CrmError::InvalidRequest(format!(
                "stage labels must be at most {MAX_STAGE_LABEL_CHARS} characters"
            )));
        }
        if !seen_labels.insert(label.to_lowercase()) {
            return Err(CrmError::InvalidRequest(format!(
                "duplicate stage label: {label}"
            )));
        }
        if let Some(id) = stage.id
            && !seen_ids.insert(id)
        {
            return Err(CrmError::InvalidRequest(format!(
                "stage {id} appears more than once"
            )));
        }
        normalized.push(StageInput {
            id: stage.id,
            label,
        });
    }
    Ok(normalized)
}

impl<TS, SD> CrmStageService for CrmStageServiceImpl<TS, SD>
where
    TS: TeamSettingsStore,
    SD: StageDefinitionStore,
{
    #[tracing::instrument(skip(self, access, stages), err)]
    async fn replace_stages(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        stages: Vec<StageInput>,
    ) -> Result<TeamStageSet, CrmError> {
        let settings = self.require_edit_stages_role(access).await?;
        let requested = validate_stage_inputs(stages)?;

        let Some(current) = self.stage_definitions.get_team_stage_set(access).await? else {
            if let Some(stage) = requested.iter().find(|stage| stage.id.is_some()) {
                return Err(CrmError::InvalidRequest(format!(
                    "stage {} does not exist: the team has no custom stages yet",
                    stage.id.unwrap_or_default()
                )));
            }
            let labels: Vec<String> = requested.into_iter().map(|stage| stage.label).collect();
            let set = self
                .stage_definitions
                .create_team_stage_set(access, &labels)
                .await?;
            self.clear_closed_stage_ids(access, &settings).await?;
            return Ok(set);
        };

        let existing: HashMap<Uuid, &TeamStage> = current
            .stages
            .iter()
            .map(|stage| (stage.id, stage))
            .collect();
        if let Some(unknown) = requested
            .iter()
            .filter_map(|stage| stage.id)
            .find(|id| !existing.contains_key(id))
        {
            return Err(CrmError::InvalidRequest(format!(
                "stage {unknown} does not belong to the team's pipeline"
            )));
        }

        let kept: HashSet<Uuid> = requested.iter().filter_map(|stage| stage.id).collect();
        let mut plan = StageReplacePlan {
            delete: current
                .stages
                .iter()
                .map(|stage| stage.id)
                .filter(|id| !kept.contains(id))
                .collect(),
            ..Default::default()
        };
        for (index, stage) in requested.into_iter().enumerate() {
            let display_order = i32::try_from(index)
                .map_err(|_| CrmError::InvalidRequest("too many stages".into()))?;
            match stage.id {
                Some(id) => {
                    let unchanged = existing.get(&id).is_some_and(|current| {
                        current.label == stage.label && current.display_order == display_order
                    });
                    if !unchanged {
                        plan.rewrite.push(StageRewrite {
                            id,
                            label: stage.label,
                            display_order,
                        });
                    }
                }
                None => plan.insert.push(StageInsert {
                    label: stage.label,
                    display_order,
                }),
            }
        }

        let set = if plan == StageReplacePlan::default() {
            current
        } else {
            self.stage_definitions
                .replace_stages(access, current.definition_id, plan)
                .await?
        };
        let live: Vec<Uuid> = set.stages.iter().map(|stage| stage.id).collect();
        self.prune_closed_stage_ids(access, &settings, &live)
            .await?;
        Ok(set)
    }

    #[tracing::instrument(skip(self, access), err)]
    async fn reset_stages(&self, access: &CrmTeamReceipt<MemberTeamRole>) -> Result<(), CrmError> {
        let settings = self.require_edit_stages_role(access).await?;
        if let Some(current) = self.stage_definitions.get_team_stage_set(access).await? {
            self.stage_definitions
                .delete_team_stage_set(access, current.definition_id)
                .await?;
        }
        self.clear_closed_stage_ids(access, &settings).await
    }
}

/// [`CrmStageService`] that panics on every call.
#[derive(Clone, Debug)]
pub struct NoOpCrmStageService;

impl CrmStageService for NoOpCrmStageService {
    async fn replace_stages(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _stages: Vec<StageInput>,
    ) -> Result<TeamStageSet, CrmError> {
        unimplemented!("NoOpCrmStageService.replace_stages")
    }

    async fn reset_stages(&self, _access: &CrmTeamReceipt<MemberTeamRole>) -> Result<(), CrmError> {
        unimplemented!("NoOpCrmStageService.reset_stages")
    }
}
