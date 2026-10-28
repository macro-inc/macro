//! Email snooze API service and caller-aware collection reads.
use super::{service::EmailFollowupService, *};
use crate::domain::{
    models::*,
    ports::{Clock, RemindersService},
};
use email::domain::followup::EmailFollowupMailbox;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Application-facing service for email snoozes.
#[derive(Clone)]
pub struct EmailRemindersService<R, E, C, A = entity_access::domain::ports::NoOpEntityAccessService>
{
    email: EmailFollowupService<R, E, C>,
    access: A,
}
impl<R, E, C> EmailRemindersService<R, E, C> {
    /// Wire the shared email workflow into the API.
    pub fn new(email: EmailFollowupService<R, E, C>) -> Self {
        Self {
            email,
            access: entity_access::domain::ports::NoOpEntityAccessService,
        }
    }
}
impl<R, E, C, A> EmailRemindersService<R, E, C, A> {
    /// Supply the caller-aware access service used by collection and summary reads.
    pub fn with_entity_access<B>(self, access: B) -> EmailRemindersService<R, E, C, B> {
        EmailRemindersService {
            email: self.email,
            access,
        }
    }
}
impl<
    R: EmailFollowupRepo,
    E: EmailFollowupMailbox,
    C: Clock,
    A: entity_access::domain::ports::EntityAccessService,
> RemindersService for EmailRemindersService<R, E, C, A>
{
    async fn list_email_reminders(
        &self,
        viewer: crate::domain::email_collection::EmailReminderViewer,
        query: crate::domain::email_collection::EmailReminderQuery,
    ) -> Result<crate::domain::email_collection::EmailReminderPage, ReminderError> {
        crate::domain::email_collection::service::list(
            &self.email.repo,
            &self.email.mailbox,
            &self.access,
            &self.email.clock,
            viewer,
            query,
        )
        .await
    }

    async fn get_email_followup(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
    ) -> Result<Option<EmailFollowup>, ReminderError> {
        self.email.get(user, thread).await
    }
    async fn execute_email_followup(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
        command: EmailFollowupCommand,
    ) -> Result<EmailFollowup, ReminderError> {
        self.email.execute(user, thread, command).await
    }
}
