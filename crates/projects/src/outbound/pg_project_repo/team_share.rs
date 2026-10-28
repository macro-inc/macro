#[cfg(test)]
mod test;

use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::ProjectError;

impl From<sqlx::Error> for ProjectError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

pub(super) fn map_team_share_error(error: rootcause::Report<TeamShareError>) -> ProjectError {
    match error.current_context() {
        TeamShareError::NotFound => ProjectError::NotFound("team-share project".to_string()),
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            ProjectError::Conflict(error.to_string())
        }
        TeamShareError::InvalidAdoption
        | TeamShareError::InvalidEntity
        | TeamShareError::InvalidState
        | TeamShareError::Infrastructure => ProjectError::Internal(error.into()),
    }
}

fn project_entity(project_id: &str) -> Entity<'_> {
    EntityType::Project.with_entity_str(project_id)
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_team_share_facts(
    pool: &PgPool,
    project_id: &str,
) -> Result<TeamShareFacts, ProjectError> {
    let mut transaction = pool.begin().await?;
    let facts = team_share::load_facts(&mut transaction, &project_entity(project_id))
        .await
        .map_err(map_team_share_error)?;
    transaction.commit().await?;
    Ok(facts)
}

#[tracing::instrument(err, skip(transaction, share_permission, team_share))]
pub(super) async fn apply_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
    team_share: Option<&AuthorizedTeamShareCommand>,
) -> Result<(), ProjectError> {
    let requested_level = share_permission.and_then(|p| p.team_share_access_level);
    match team_share {
        Some(command) => {
            let expected = &command.expected().entity;
            if expected.entity_type != EntityType::Project
                || expected.entity_id != project_id
                || requested_level != Some(command.target().map(|grant| grant.level.into()))
            {
                return Err(ProjectError::BadRequest(
                    "team-share command does not match patch".to_string(),
                ));
            }
            team_share::apply(transaction, command)
                .await
                .map_err(map_team_share_error)
        }
        None if requested_level.is_some() => Err(ProjectError::Unauthorized),
        None => Ok(()),
    }
}
