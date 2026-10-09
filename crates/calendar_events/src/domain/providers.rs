//! Dispatch calendar mutations using the authorized target's provider.
use super::{models::*, ports::*};
use uuid::Uuid;

/// Provider composition without leaking either transport into callers.
pub struct CalendarProviders<G, O> {
    /// Google Calendar adapter.
    pub google: G,
    /// Microsoft Graph adapter.
    pub outlook: O,
}
impl<G: CalendarMutationProvider, O: CalendarMutationProvider> CalendarMutationProvider
    for CalendarProviders<G, O>
{
    async fn delete_created_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        key: Uuid,
    ) -> Result<Vec<String>, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => self.google.delete_created_event(token, target, key).await,
            CalendarProvider::Outlook => {
                self.outlook.delete_created_event(token, target, key).await
            }
        }
    }
    async fn create_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        draft: &CalendarEventDraft,
    ) -> Result<CalendarEventUpsert, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => self.google.create_event(access_token, target, draft).await,
            CalendarProvider::Outlook => {
                self.outlook.create_event(access_token, target, draft).await
            }
        }
    }
    async fn update_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        provider_event_id: &str,
        patch: &CalendarEventPatch,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .update_event(access_token, target, provider_event_id, patch)
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .update_event(access_token, target, provider_event_id, patch)
                    .await
            }
        }
    }
    async fn update_event_instance(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
        patch: &CalendarEventPatch,
    ) -> Result<ProviderInstanceUpdateOutcome, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .update_event_instance(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                        patch,
                    )
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .update_event_instance(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                        patch,
                    )
                    .await
            }
        }
    }
    async fn delete_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        provider_event_id: &str,
    ) -> Result<(), CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .delete_event(access_token, target, provider_event_id)
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .delete_event(access_token, target, provider_event_id)
                    .await
            }
        }
    }
    async fn delete_event_instance(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<ProviderSeriesMutationOutcome, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .delete_event_instance(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                    )
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .delete_event_instance(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                    )
                    .await
            }
        }
    }
    async fn truncate_recurring_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> Result<ProviderSeriesMutationOutcome, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .truncate_recurring_event(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                    )
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .truncate_recurring_event(
                        access_token,
                        target,
                        master_provider_event_id,
                        original_start,
                    )
                    .await
            }
        }
    }
    async fn rsvp_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> Result<ProviderRsvpOutcome, CalendarProviderError> {
        match target.provider {
            CalendarProvider::Google => {
                self.google
                    .rsvp_event(
                        access_token,
                        target,
                        master_provider_event_id,
                        actor,
                        response,
                        scope,
                    )
                    .await
            }
            CalendarProvider::Outlook => {
                self.outlook
                    .rsvp_event(
                        access_token,
                        target,
                        master_provider_event_id,
                        actor,
                        response,
                        scope,
                    )
                    .await
            }
        }
    }
    async fn stop_watch_channel(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        channel_id: &str,
        resource_id: &str,
    ) -> Result<(), CalendarProviderError> {
        self.google
            .stop_watch_channel(access_token, email_link_id, channel_id, resource_id)
            .await
    }
}

impl<G: Send + Sync + 'static, O: super::replacement::CalendarReplacementProvider>
    super::replacement::CalendarReplacementProvider for CalendarProviders<G, O>
{
    async fn inspect_replacement(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        master: &str,
        recurrence_id: Option<&str>,
        remove_conference: bool,
    ) -> Result<super::replacement::ReplacementSnapshot, CalendarProviderError> {
        self.outlook
            .inspect_replacement(token, target, master, recurrence_id, remove_conference)
            .await
    }
    async fn event_url(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        recurrence_id: Option<&str>,
    ) -> Result<Option<String>, CalendarProviderError> {
        self.outlook
            .event_url(token, target, id, recurrence_id)
            .await
    }
    async fn prepare_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        operation: &super::replacement::CalendarReplacement,
    ) -> Result<serde_json::Value, CalendarProviderError> {
        self.outlook
            .prepare_replacement_write(token, target, operation)
            .await
    }
    async fn apply_replacement_write(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        command: &serde_json::Value,
        allow_create: bool,
    ) -> Result<super::replacement::ReplacementWriteOutcome, CalendarProviderError> {
        self.outlook
            .apply_replacement_write(token, target, command, allow_create)
            .await
    }
    async fn replacement_echo(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> Result<Option<CalendarEventUpsert>, CalendarProviderError> {
        self.outlook.replacement_echo(token, target, id).await
    }
}
