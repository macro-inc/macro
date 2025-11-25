use crate::domain::{
    models::{EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest, PreviewCursorQuery},
    ports::{EmailRepo, EmailService},
};
use frecency::domain::{models::FrecencyByIdsRequest, ports::FrecencyQueryService};
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_pagination::{CollectBy, PaginateOn, PaginatedCursor, SimpleSortMethod};
use std::{collections::HashMap, str::FromStr};
use uuid::Uuid;

pub struct EmailServiceImpl<T, U> {
    email_repo: T,
    frecency_service: U,
}

impl<T, U> EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
{
    pub fn new(email_repo: T, frecency_service: U) -> EmailServiceImpl<T, U> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
        }
    }
}

impl<T, U> EmailService for EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    anyhow::Error: From<T::Err>,
{
    async fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        let GetEmailsRequest {
            view,
            link_id,
            macro_id,
            limit,
            query,
        } = req;
        let sort_method = *query.sort_method();

        const MIN_PAGE: u32 = 20;
        const MAX_PAGE: u32 = 500;

        let limit = limit.unwrap_or_default().clamp(MIN_PAGE, MAX_PAGE);

        let query = PreviewCursorQuery {
            view,
            link_id,
            limit,
            query,
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

        let (
            attachment_map_result,
            macro_attachment_map_result,
            participant_result,
            labels_result,
            frecency_scores,
        ) = tokio::join!(
            self.email_repo.attachments_by_thread_ids(&thread_ids),
            self.email_repo.macro_attachments_by_thread_ids(&thread_ids),
            self.email_repo.contacts_by_thread_ids(&thread_ids),
            self.email_repo.labels_by_thread_ids(&thread_ids),
            self.frecency_service
                .get_frecencies_by_ids(frecency_request)
        );

        let mut attachment_map = attachment_map_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);
        let mut macro_attachment_map = macro_attachment_map_result
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

        let mut frecency_scores_map: HashMap<Uuid, f64> = frecency_scores?
            .into_inner()
            .into_iter()
            .filter_map(|(id, data)| {
                Some((
                    Uuid::from_str(&id.entity.entity_id).ok()?,
                    data.frecency_score,
                ))
            })
            .collect();

        Ok(previews
            .into_iter()
            .map(|thread| EnrichedEmailThreadPreview {
                attachments: attachment_map.remove(&thread.id).unwrap_or_default(),
                attachments_macro: macro_attachment_map.remove(&thread.id).unwrap_or_default(),
                participants: participant_map.remove(&thread.id).unwrap_or_default(),
                labels: labels_map.remove(&thread.id).unwrap_or_default(),
                frecency_score: frecency_scores_map.remove(&thread.id),
                thread,
            })
            .paginate_on(limit as usize, sort_method)
            .into_page())
    }
}
