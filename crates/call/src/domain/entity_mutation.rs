//! Unified entity-mutation capability impls for calls.

use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessReceipt, ViewAccessLevel,
};
use entity_mutation::{
    DeleteEntityPermanently, EntityMutationErrorCode, RenameEntity, UpdateEntitySharePolicy,
};
use macro_event_broker::MacroEventBroker;
use model_entity::Entity;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use super::{
    models::{CallError, EditCallRecordRequest},
    ports::CallService,
    service::CallServiceImpl,
};
use connection::domain::ports::ConnectionService;
use notification::domain::{ports::VoipPushSender, service::NotificationIngress};

use crate::domain::ports::{
    CallRepository, CallRtcClient, CallSearchIndexer, CallSummarizer, RecordingStorage,
    VoiceRepository,
};

impl From<CallError> for EntityMutationErrorCode {
    fn from(error: CallError) -> Self {
        match error {
            error @ CallError::NotFound(_) => Self::not_found(rootcause::report!(error)),
            error @ (CallError::Auth | CallError::NotInCall) => {
                Self::forbidden(rootcause::report!(error))
            }
            error @ CallError::InvalidRequest(_) => Self::invalid(rootcause::report!(error)),
            error @ CallError::AlreadyInCall(_) => Self::conflict(rootcause::report!(error)),
            error @ CallError::Internal(_) => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Map an access-domain error onto the public mutation vocabulary.
fn access_error(error: AccessError) -> EntityMutationErrorCode {
    match error {
        error @ (AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
            EntityMutationErrorCode::forbidden(rootcause::report!(error))
        }
        error @ AccessError::NotFound(_) => {
            EntityMutationErrorCode::not_found(rootcause::report!(error))
        }
        error @ AccessError::BadRequest(_) => {
            EntityMutationErrorCode::invalid(rootcause::report!(error))
        }
        error @ (AccessError::DatabaseError(_) | AccessError::Internal) => {
            EntityMutationErrorCode::internal(rootcause::report!(error))
        }
    }
}

/// Reject the mutation while the call is still active.
async fn require_archived_call<S: CallService>(
    service: &S,
    edit_receipt: &EntityAccessReceipt<EditAccessLevel>,
    operation: &str,
) -> Result<(), EntityMutationErrorCode> {
    let view_receipt = edit_receipt
        .clone()
        .try_into_requirement::<ViewAccessLevel>()
        .map_err(access_error)?;
    if service.get_call_record(view_receipt).await?.is_active {
        return Err(EntityMutationErrorCode::conflict(rootcause::report!(
            format!("cannot {operation} an active call")
        )));
    }
    Ok(())
}

impl<R, C, Cn, E, N, S, Sm, I, V, Vr, B> RenameEntity
    for CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr, B>
where
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: entity_access::domain::ports::EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository,
    B: MacroEventBroker,
    Self: CallService,
{
    type Receipt = EditAccessLevel;

    async fn rename_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        require_archived_call(self, &receipt, "rename").await?;
        self.edit_call_record(
            receipt,
            EditCallRecordRequest {
                share_permission: None,
                share_with_team: None,
                custom_name: Some(display_name),
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, C, Cn, E, N, S, Sm, I, V, Vr, B> UpdateEntitySharePolicy
    for CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr, B>
where
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: entity_access::domain::ports::EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository,
    B: MacroEventBroker,
    Self: CallService,
{
    type Receipt = EditAccessLevel;

    async fn update_share_policy(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        require_archived_call(self, &receipt, "update sharing for").await?;
        self.edit_call_record(
            receipt,
            EditCallRecordRequest {
                share_permission: Some(policy),
                share_with_team: None,
                custom_name: None,
            },
        )
        .await?;
        Ok(Vec::new())
    }
}

impl<R, C, Cn, E, N, S, Sm, I, V, Vr, B> DeleteEntityPermanently
    for CallServiceImpl<R, C, Cn, E, N, S, Sm, I, V, Vr, B>
where
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: entity_access::domain::ports::EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
    I: CallSearchIndexer,
    V: VoipPushSender,
    Vr: VoiceRepository,
    B: MacroEventBroker,
    Self: CallService,
{
    type Receipt = EditAccessLevel;

    async fn delete_entity_permanently(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<Entity<'static>>, EntityMutationErrorCode> {
        require_archived_call(self, &receipt, "permanently delete").await?;
        self.delete_call_record(receipt).await?;
        Ok(Vec::new())
    }
}
