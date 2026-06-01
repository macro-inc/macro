use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::models::MemberTeamRole;

use crate::domain::{
    models::{
        EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest, PreviewCursorQuery, UserProvider,
    },
    ports::EmailRepo,
};
use frecency::domain::{
    models::{AggregateId, FrecencyByIdsRequest, FrecencyData},
    ports::FrecencyQueryService,
};
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_pagination::{CollectBy, PaginateOn, PaginatedCursor, SimpleSortMethod};
use std::collections::HashMap;
use uuid::Uuid;

use super::EmailServiceImpl;

impl<T, U, E, CS> EmailServiceImpl<T, U, E, CS>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: crate::domain::ports::EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, req))]
    pub(crate) async fn get_email_thread_previews_impl(
        &self,
        req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        let GetEmailsRequest {
            view,
            link_ids,
            macro_id,
            limit,
            query,
            team_receipt,
            crm_scope,
        } = req;

        let team_id = self
            .validate_crm_scope(team_receipt.as_ref(), crm_scope.as_ref())
            .await?;

        let sort_method = *query.sort_method();

        const MIN_PAGE: u32 = 20;
        const MAX_PAGE: u32 = 500;

        let limit = limit.unwrap_or_default().clamp(MIN_PAGE, MAX_PAGE);

        let query = PreviewCursorQuery {
            view,
            link_ids,
            limit,
            query,
            team_id,
        };

        let previews = self
            .email_repo
            .previews_for_view_cursor(query, macro_id.copied().into_owned())
            .await
            .map_err(anyhow::Error::from)?;

        let thread_ids: Vec<Uuid> = previews.iter().map(|p| p.id).collect();

        let ids: Vec<_> = thread_ids
            .iter()
            .map(|id| EntityType::EmailThread.with_entity_string(id.to_string()))
            .collect();

        let frecency_request = FrecencyByIdsRequest {
            user_id: macro_id,
            ids: ids.as_slice(),
        };

        let (attachment_map_result, participant_result, labels_result, frecency_scores) = tokio::join!(
            self.email_repo.attachments_by_thread_ids(&thread_ids),
            self.email_repo.contacts_by_thread_ids(&thread_ids),
            self.email_repo.labels_by_thread_ids(&thread_ids),
            self.frecency_service
                .get_frecencies_by_ids(frecency_request)
        );

        let mut attachment_map = attachment_map_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);
        let mut participant_map = participant_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);
        let mut labels_map = labels_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);

        let mut frecency_scores_map: HashMap<AggregateId<'static>, FrecencyData> =
            frecency_scores?.into_inner();

        Ok(previews
            .into_iter()
            .map(|thread| {
                let id = AggregateId {
                    user_id: thread.owner_id.clone(),
                    entity: EntityType::EmailThread.with_entity_string(thread.id.to_string()),
                };

                EnrichedEmailThreadPreview {
                    attachments: attachment_map.remove(&thread.id).unwrap_or_default(),
                    labels: labels_map.remove(&thread.id).unwrap_or_default(),
                    participants: participant_map.remove(&thread.id).unwrap_or_default(),
                    frecency_score: frecency_scores_map
                        .remove(&id)
                        .map(|data| id.into_aggregate(data)),
                    thread,
                }
            })
            .paginate_on(limit as usize, sort_method)
            .into_page())
    }

    pub(crate) async fn get_link_by_auth_id_and_macro_id_impl(
        &self,
        auth_id: &str,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<crate::domain::models::Link>, EmailErr> {
        Ok(self
            .email_repo
            .link_by_fusionauth_and_macro_id(auth_id, macro_id, UserProvider::Gmail)
            .await
            .map_err(anyhow::Error::from)?)
    }

    /// CRM-scope validation for the new `crm_domains` / `crm_addresses`
    /// filter attributes. Returns `Ok(Some(team_id))` when the scope is
    /// present and every requested domain/address passes the per-team CRM
    /// pre-check; `Ok(None)` when no scope was requested.
    ///
    /// Errors:
    ///   * `Unauthorized` — caller has no qualifying team membership but
    ///     the filter requested CRM scope.
    ///   * `CrmDisabledForTeam` — `team_crm_settings.crm_enabled = false`.
    ///   * `CrmDomainNotFound` / `CrmDomainNotPermitted` —
    ///     per-domain failure (no row / hidden company / email_sync off).
    ///   * `CrmAddressNotFound` / `CrmAddressNotPermitted` —
    ///     per-address failure (no row / hidden contact / hidden company / email_sync off).
    async fn validate_crm_scope(
        &self,
        team_receipt: Option<&EntityAccessReceipt<MemberTeamRole>>,
        crm_scope: Option<&item_filters::ast::CrmScope>,
    ) -> Result<Option<Uuid>, EmailErr> {
        let Some(scope) = crm_scope else {
            return Ok(None);
        };

        let receipt = team_receipt.ok_or(EmailErr::Unauthorized)?;
        let team_id = Uuid::parse_str(&receipt.entity().entity_id).map_err(|e| {
            EmailErr::RepoErr(anyhow::anyhow!(
                "team_receipt entity_id is not a valid uuid: {e}"
            ))
        })?;

        let (domains, addresses): (&[String], &[String]) = match scope {
            item_filters::ast::CrmScope::Domains(d) => (d.as_slice(), &[]),
            item_filters::ast::CrmScope::Addresses(a) => (&[], a.as_slice()),
        };

        let precheck = self
            .crm_service
            .crm_scope_precheck(&team_id, domains, addresses)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::anyhow!("crm precheck failed: {e}")))?;

        if !precheck.crm_enabled {
            return Err(EmailErr::CrmDisabledForTeam);
        }

        for status in &precheck.domains {
            if !status.exists {
                return Err(EmailErr::CrmDomainNotFound(status.domain.clone()));
            }
            if status.company_hidden || !status.email_sync {
                return Err(EmailErr::CrmDomainNotPermitted(status.domain.clone()));
            }
        }

        for status in &precheck.addresses {
            if !status.exists {
                return Err(EmailErr::CrmAddressNotFound(status.address.clone()));
            }
            if status.contact_hidden || status.company_hidden || !status.email_sync {
                return Err(EmailErr::CrmAddressNotPermitted(status.address.clone()));
            }
        }

        Ok(Some(team_id))
    }
}
