use crate::domain::models::{
    EmailThreadPreview, EmailThreadPreviewMetadata, IntermediateThreadMetadata,
};
use crate::domain::ports::EmailRepo;
use crate::domain::service::EmailServiceImpl;
use frecency::domain::ports::FrecencyQueryService;
use std::collections::HashMap;
use uuid::Uuid;

impl<T, U> EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
{
    /// get metadata for thread previews, used by FE for filtering Important vs Other threads
    pub(crate) async fn get_preview_metadata(
        &self,
        previews: &[EmailThreadPreview],
        link_id: &Uuid,
    ) -> Result<HashMap<Uuid, EmailThreadPreviewMetadata>, T::Err> {
        let thread_ids: Vec<Uuid> = previews.iter().map(|p| p.id).collect();

        let (known_senders_threads, thread_metadata) = tokio::join!(
            self.email_repo
                .threads_with_known_senders(link_id, &thread_ids),
            self.email_repo.thread_metadata_by_thread_ids(&thread_ids)
        );

        let known_senders_threads = known_senders_threads?;
        let thread_metadata = thread_metadata?;

        let metadata_map_by_thread: HashMap<Uuid, &IntermediateThreadMetadata> =
            thread_metadata.iter().map(|m| (m.thread_id, m)).collect();

        let metadata_map: HashMap<Uuid, EmailThreadPreviewMetadata> = thread_ids
            .into_iter()
            .map(|id| {
                let metadata = metadata_map_by_thread.get(&id);
                let generic_sender = metadata
                    .map(|m| {
                        m.sender_emails
                            .iter()
                            .any(|e| email_utils::is_generic_email(e))
                    })
                    .unwrap_or(false);

                (
                    id,
                    EmailThreadPreviewMetadata {
                        known_sender: known_senders_threads.contains(&id),
                        tabular: metadata.map(|m| m.has_table).unwrap_or(false),
                        calendar_invite: metadata.map(|m| m.has_calendar_invite).unwrap_or(false),
                        generic_sender,
                    },
                )
            })
            .collect();

        Ok(metadata_map)
    }
}
