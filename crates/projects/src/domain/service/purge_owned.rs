//! Owner-checked permanent delete of a project tree, for callers removing an
//! owner.

#[cfg(test)]
mod test;

use entity_access::domain::models::{EntityAccessReceipt, EntityType, OwnerAccessLevel};
use entity_access_management::domain::ports::EntityAccessManagementService;
use macro_event_broker::MacroEventBroker;
use model_owner::Owner;
use rootcause::{Report, prelude::*};
use shared_entity_registry::{OwnedPurgeOutcome, PurgeOwnedEntity};

use super::ProjectServiceImpl;
use crate::domain::models::ProjectError;
use crate::domain::ports::{
    BulkUploadRequestPort, ProjectRepo, ProjectSearchIndexer, ProjectService, ProjectUploadUrlPort,
    ShaCounterPort,
};

impl<R, U, D, Sha, Eam, Idx, B> PurgeOwnedEntity for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, B>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    B: MacroEventBroker,
{
    #[tracing::instrument(
        skip(self, expected_owner),
        fields(expected_owner.kind = ?expected_owner.owner_type()),
        err
    )]
    async fn purge_owned(
        &self,
        entity_id: uuid::Uuid,
        expected_owner: &Owner,
    ) -> Result<OwnedPurgeOutcome, Report> {
        let project_id = entity_id.to_string();
        let project = match self.internal_get_basic_project(&project_id).await {
            Err(ProjectError::NotFound(_)) => return Ok(OwnedPurgeOutcome::Purged),
            loaded => loaded.context("unable to look up the project")?,
        };
        if project.user_id != *expected_owner {
            return Ok(OwnedPurgeOutcome::OwnedElsewhere);
        }
        let receipt = EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_internal_user(
            &project_id,
            EntityType::Project,
        );
        // The tree purge only removes a trashed tree.
        if project.deleted_at.is_none() {
            self.soft_delete_project(receipt.clone(), project.clone(), String::new())
                .await
                .context("unable to trash the project")?;
        }
        self.permanently_delete_project(receipt, project)
            .await
            .context("unable to permanently delete the project")?;
        Ok(OwnedPurgeOutcome::Purged)
    }
}
