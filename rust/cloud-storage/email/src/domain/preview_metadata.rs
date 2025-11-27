use crate::domain::models::{EmailThreadPreview, EmailThreadPreviewMetadata};
use std::collections::HashMap;
use uuid::Uuid;
use frecency::domain::ports::FrecencyQueryService;
use crate::domain::ports::{EmailRepo, EmailService};
use crate::domain::service::EmailServiceImpl;

impl<T, U> EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
{
    async fn get_preview_metadata(
        &self,
        previews: &[EmailThreadPreview],
        user_email: &str,
    ) -> Result<HashMap<Uuid, EmailThreadPreviewMetadata>, T::Err> {
        let thread_ids: Vec<Uuid> = previews.iter().map(|p| p.id).collect();
        let known_senders_threads = self
            .email_repo
            .threads_with_known_senders(user_email, &thread_ids)
            .await?;

        let tabular_message_threads = self
            .email_repo
            .threads_with_tabular_messages(&thread_ids)
            .await?;

        // Build your metadata map
        let mut metadata_map = HashMap::new();
        previews.iter().map(|p| metadata_map.entry(EmailThreadPreviewMetadata{
            known_sender: known_senders_threads.contains(&p.id),
            tabular: tabular_message_threads.contains(&p.id),
            calendar_invite: p,
            generic_sender: false,
        }))

        Ok(metadata_map)
    }
}

