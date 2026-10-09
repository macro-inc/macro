use super::*;
use models_forms::UpdateForm;
use models_permissions::share_permission::{
    UpdateSharePermissionRequestV2,
    access_level::AccessLevel,
    channel_share_permission::{UpdateChannelSharePermission, UpdateOperation},
};

impl<
    C: AuthoringCore,
    D: DatabasesService,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> AuthoringWorkflow<C, D, B, A, E>
{
    pub(super) async fn set_access(
        &self,
        actor: Viewer,
        intent: SetAccess,
    ) -> Result<MutationResult, AuthoringError> {
        let owner = self
            .receipt::<OwnerAccessLevel>(&actor, intent.form_id)
            .await?;
        let receipt = owner
            .clone()
            .try_into_requirement::<EditAccessLevel>()
            .map_err(failure)?;
        let outcome = Self::result(intent.form_id, KeyMap::default());
        let result = async {
            self.core
                .update_form(
                    receipt.clone(),
                    UpdateForm {
                        audience: Some(intent.draft.audience),
                        status: Some(intent.draft.status),
                        closes_at: Some(intent.draft.closes_at),
                        tally_visible: Some(intent.draft.tally_visible),
                        ..Default::default()
                    },
                )
                .await
                .map_err(form_failure)?;
            if !intent.draft.channel_grants.is_empty() {
                let grants = intent
                    .draft
                    .channel_grants
                    .into_iter()
                    .map(|change| match change {
                        GrantChange::Upsert { channel_id, access } => {
                            UpdateChannelSharePermission {
                                operation: UpdateOperation::Replace,
                                channel_id: channel_id.to_string(),
                                access_level: Some(match access {
                                    GrantAccess::View => AccessLevel::View,
                                    GrantAccess::Edit => AccessLevel::Edit,
                                }),
                            }
                        }
                        GrantChange::Remove { channel_id } => UpdateChannelSharePermission {
                            operation: UpdateOperation::Remove,
                            channel_id: channel_id.to_string(),
                            access_level: None,
                        },
                    })
                    .collect();
                self.core
                    .update_share_permissions(
                        owner,
                        UpdateSharePermissionRequestV2 {
                            link_share: None,
                            link_share_access_level: None,
                            team_share_access_level: None,
                            channel_share_permissions: Some(grants),
                        },
                    )
                    .await
                    .map_err(form_failure)?;
            }
            self.core
                .authoring_snapshot(receipt)
                .await
                .map_err(form_failure)
        }
        .await;
        Ok(self.outcome(outcome, result))
    }
}
