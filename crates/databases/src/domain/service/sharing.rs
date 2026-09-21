use super::*;
use crate::domain::sharing::{
    DatabaseSharePermissions, DatabaseSharingRepo, DatabaseSharingService,
};
use models_permissions::share_permission::{
    access_level::AccessLevel as ShareAccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> DatabaseSharingService
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo + DatabaseSharingRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt), err)]
    async fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<DatabaseSharePermissions, DatabaseError> {
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        let channel_share_permissions = self
            .repo
            .channel_grants(database.id)
            .await
            .map_err(repo_err)?;
        Ok(DatabaseSharePermissions {
            id: database.id,
            owner: database.owner_id.to_string(),
            channel_share_permissions,
        })
    }

    #[tracing::instrument(skip(self, receipt, grants), err)]
    async fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        grants: Vec<UpdateChannelSharePermission>,
    ) -> Result<DatabaseSharePermissions, DatabaseError> {
        if grants.len() > 100 {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Share with at most 100 channels at a time.".into(),
            ));
        }
        let mut channels = HashSet::new();
        for grant in &grants {
            if !channels.insert(&grant.channel_id)
                || Uuid::parse_str(&grant.channel_id).is_err()
                || grant.access_level == Some(ShareAccessLevel::Owner)
                || (grant.operation != UpdateOperation::Remove && grant.access_level.is_none())
            {
                return Err(DatabaseError::InvalidSchemaOperation(
                    "Choose a channel and view, comment, or edit access.".into(),
                ));
            }
        }
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        if !self
            .repo
            .update_channel_grants(database.id, &grants)
            .await
            .map_err(repo_err)?
        {
            return Err(DatabaseError::NotFound);
        }
        self.share_permissions(receipt).await
    }
}
