//! Unified entity-mutation capability impls for channels.

use entity_access::domain::models::{
    AdminParticipantRole, EntityAccessReceipt, OwnerParticipantRole, RequiredPermission,
};
use entity_mutation::{DeleteEntityPermanently, EntityMutationErrorCode, RenameEntity};
use model_entity::Entity;
use uuid::Uuid;

use super::{
    models::{PatchChannelRequest, Sender},
    ports::{ChannelMutationErr, ChannelService},
    service::ChannelServiceImpl,
};

impl From<ChannelMutationErr> for EntityMutationErrorCode {
    fn from(error: ChannelMutationErr) -> Self {
        match error {
            error @ ChannelMutationErr::BadRequest(_) => Self::invalid(rootcause::report!(error)),
            error @ (ChannelMutationErr::Unauthorized(_) | ChannelMutationErr::Forbidden(_)) => {
                Self::forbidden(rootcause::report!(error))
            }
            error @ ChannelMutationErr::NotFound(_) => Self::not_found(rootcause::report!(error)),
            error => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Parse the channel id, rejecting non-UUID identifiers.
fn channel_uuid(entity: &Entity<'static>) -> Result<Uuid, EntityMutationErrorCode> {
    Uuid::parse_str(&entity.entity_id)
        .map_err(|error| EntityMutationErrorCode::invalid(rootcause::report!(error)))
}

/// Convert the authenticated receipt holder into a channel sender.
fn sender_from_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Sender, EntityMutationErrorCode> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map(Sender::new_from_user)
        .map_err(|error| EntityMutationErrorCode::forbidden(rootcause::report!(error)))
}

impl<R, E, P, M> RenameEntity for ChannelServiceImpl<R, E, P, M>
where
    Self: ChannelService,
{
    type Receipt = AdminParticipantRole;

    async fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let channel_id = channel_uuid(&entity)?;
        let sender = sender_from_receipt(&receipt)?;
        self.patch_channel(
            sender,
            channel_id,
            PatchChannelRequest {
                channel_name: Some(display_name),
                convert_to_team_channel: None,
                auto_join_team: None,
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, E, P, M> DeleteEntityPermanently for ChannelServiceImpl<R, E, P, M>
where
    Self: ChannelService,
{
    type Receipt = OwnerParticipantRole;

    async fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        let channel_id = channel_uuid(&entity)?;
        let sender = sender_from_receipt(&receipt)?;
        self.delete_channel(sender, channel_id).await?;
        Ok(Vec::new())
    }
}
