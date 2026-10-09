//! Owners share a form with channels, as a database is shared; link and
//! team sharing are refused, since a form's public audience is its own.

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use std::collections::HashSet;

use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel};
use macro_event_broker::MacroEventBroker;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use uuid::Uuid;

use super::{FormsServiceImpl, receipt_attribution, receipt_form_id, repository_error};
use crate::domain::events::{FormChangedMetadata, FormTopicEvent};
use crate::domain::models::{FormError, SharingRefusal};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};
use crate::domain::sharing::{FormSharingRepo, FormSharingService};

/// Most channel grants one request may change.
const MAX_CHANNEL_GRANTS_PER_UPDATE: usize = 100;

impl<Repository, Databases, Access, Events, Now, Broker, Drafts> FormSharingService
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts>
where
    Repository: FormsRepo + FormSharingRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
{
    #[tracing::instrument(skip(self, receipt), err)]
    async fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, FormError> {
        let form = self.live_form(receipt_form_id(&receipt)?).await?;
        let channel_share_permissions = FormSharingRepo::channel_grants(&self.repository, form.id)
            .await
            .map_err(repository_error)?;
        Ok(SharePermissionV2 {
            id: form.id.to_string(),
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            owner: form.owner_id,
            channel_share_permissions: Some(channel_share_permissions),
        })
    }

    #[tracing::instrument(skip(self, receipt, request), err)]
    async fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        request: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2, FormError> {
        if matches!(request.link_share, Some(Some(_)))
            || matches!(request.link_share_access_level, Some(Some(_)))
        {
            return Err(SharingRefusal::LinkShare.into());
        }
        if matches!(request.team_share_access_level, Some(Some(_))) {
            return Err(SharingRefusal::TeamShare.into());
        }
        let grants = request.channel_share_permissions.unwrap_or_default();
        if grants.len() > MAX_CHANNEL_GRANTS_PER_UPDATE {
            return Err(SharingRefusal::TooManyChannels {
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
                return Err(SharingRefusal::InvalidChannelGrant.into());
            }
        }
        let form = self.live_form(receipt_form_id(&receipt)?).await?;
        if !FormSharingRepo::update_channel_grants(&self.repository, form.id, &grants)
            .await
            .map_err(repository_error)?
        {
            return Err(FormError::NotFound);
        }
        if !grants.is_empty() {
            self.emit(FormTopicEvent::SharingChanged(FormChangedMetadata {
                form_id: form.id,
                attribution: receipt_attribution(&receipt),
            }));
        }
        self.share_permissions(receipt).await
    }
}
