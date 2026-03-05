use chrono::Duration;

use crate::domain::{
    models::{CreateDraftInput, CreatedDraft, EmailErr, Link},
    ports::{EmailMessageEnqueuer, EmailRepo},
};
use frecency::domain::ports::FrecencyQueryService;

use super::EmailServiceImpl;

impl<T, U, E, G> EmailServiceImpl<T, U, E, G>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    anyhow::Error: From<T::Err>,
    anyhow::Error: From<E::Err>,
{
    #[tracing::instrument(err, skip(self, link, input))]
    pub(crate) async fn send_message_impl(
        &self,
        link: &Link,
        mut input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        let delay_secs = self.sent_undo_delay_secs;
        input.send_time = Some(chrono::Utc::now() + Duration::seconds(delay_secs as i64));

        let created = self
            .prepare_and_insert_db_message(link, input, false)
            .await?;

        // FE displays "Undo" button for delay_secs. Give extra time for round trip of cancel request
        let sqs_delay = delay_secs as i32 + 2;
        self.enqueuer
            .enqueue_scheduled_message(link.id, created.db_id, Some(sqs_delay))
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        Ok(created)
    }
}
