use crate::{
    OpensearchClient, Result, delete,
    upsert::{self, calendar_event::UpsertCalendarEventArgs, properties::IndexedProperty},
};

impl OpensearchClient {
    /// Upserts a calendar event series master into the opensearch
    /// calendar_events index
    #[tracing::instrument(skip(self, args), fields(event_id=%args.event_id), err)]
    pub async fn upsert_calendar_event(
        &self,
        args: &UpsertCalendarEventArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        upsert::calendar_event::upsert_calendar_event(&self.inner, args, index_override).await
    }

    /// Deletes a calendar event from the opensearch calendar_events index
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_calendar_event(
        &self,
        event_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        delete::calendar_event::delete_calendar_event_by_id(&self.inner, event_id, index_override)
            .await
    }

    /// Updates only the denormalized `properties` on an indexed calendar event
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn update_calendar_event_properties(
        &self,
        event_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        upsert::calendar_event::update_calendar_event_properties(
            &self.inner,
            event_id,
            properties,
            None,
        )
        .await
    }
}
