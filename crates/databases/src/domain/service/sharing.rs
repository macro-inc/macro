use super::*;
use crate::domain::sharing::{DatabaseSharingRepo, DatabaseSharingService};
use models_permissions::share_permission::{
    SharePermissionV2, UpdateSharePermissionRequestV2,
    access_level::AccessLevel as ShareAccessLevel, channel_share_permission::UpdateOperation,
};

/// Most channel grants one request may change.
const MAX_CHANNEL_GRANTS_PER_UPDATE: usize = 100;

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseSharingService
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo + DatabaseSharingRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt), err)]
    async fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, DatabaseError> {
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        let channel_share_permissions = self
            .repository
            .channel_grants(database.id)
            .await
            .map_err(repository_error)?;
        Ok(SharePermissionV2 {
            id: database.id.to_string(),
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            owner: database.owner_id,
            channel_share_permissions: Some(channel_share_permissions),
        })
    }

    #[tracing::instrument(skip(self, receipt, request), err)]
    async fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2, DatabaseError> {
        if matches!(request.link_share, Some(Some(_)))
            || matches!(request.link_share_access_level, Some(Some(_)))
        {
            return Err(DatabaseError::from(SharingError::LinkShare));
        }
        if matches!(request.team_share_access_level, Some(Some(_))) {
            return Err(DatabaseError::from(SharingError::TeamShare));
        }
        let grants = request.channel_share_permissions.unwrap_or_default();
        if grants.len() > MAX_CHANNEL_GRANTS_PER_UPDATE {
            return Err(SharingError::TooManyChannels {
                max: MAX_CHANNEL_GRANTS_PER_UPDATE,
            }
            .into());
        }
        let mut channels = HashSet::new();
        for grant in &grants {
            if !channels.insert(&grant.channel_id)
                || Uuid::parse_str(&grant.channel_id).is_err()
                || grant.access_level == Some(ShareAccessLevel::Owner)
                || (grant.operation != UpdateOperation::Remove && grant.access_level.is_none())
            {
                return Err(DatabaseError::from(SharingError::InvalidChannelGrant));
            }
        }
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        if !self
            .repository
            .update_channel_grants(database.id, &grants)
            .await
            .map_err(repository_error)?
        {
            return Err(DatabaseError::NotFound);
        }
        if !grants.is_empty() {
            self.emit(DatabaseMacroEvent::sharing_changed(
                events::DatabaseSharingChangedMetadata {
                    database_id: database.id,
                    attribution: receipt_attribution(&receipt),
                },
            ));
        }
        self.share_permissions(receipt).await
    }
}
