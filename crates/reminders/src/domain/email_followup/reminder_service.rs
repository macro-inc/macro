//! Preserve the specialization when the ordinary Reminders surface edits it.
use super::{service::EmailFollowupService, *};
use crate::domain::{
    models::*,
    ports::{Clock, RemindersService},
    service::receipt_owner_and_id,
};
use email::domain::followup::EmailFollowupMailbox;
use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Application-facing service, composing generic reminders and email behavior.
#[derive(Clone)]
pub struct EmailRemindersService<
    S,
    R,
    E,
    C,
    A = entity_access::domain::ports::NoOpEntityAccessService,
> {
    generic: S,
    email: EmailFollowupService<R, E, C>,
    access: A,
}
impl<S, R, E, C> EmailRemindersService<S, R, E, C> {
    /// Wire one shared email workflow into CRUD and dispatch.
    pub fn new(generic: S, email: EmailFollowupService<R, E, C>) -> Self {
        Self {
            generic,
            email,
            access: entity_access::domain::ports::NoOpEntityAccessService,
        }
    }
}
impl<S, R, E, C, A> EmailRemindersService<S, R, E, C, A> {
    /// Supply the caller-aware access service used by collection and summary reads.
    pub fn with_entity_access<B>(self, access: B) -> EmailRemindersService<S, R, E, C, B> {
        EmailRemindersService {
            generic: self.generic,
            email: self.email,
            access,
        }
    }
}
impl<
    S: RemindersService,
    R: EmailFollowupRepo,
    E: EmailFollowupMailbox,
    C: Clock,
    A: entity_access::domain::ports::EntityAccessService,
> RemindersService for EmailRemindersService<S, R, E, C, A>
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

    async fn list_collection(
        &self,
        user: &MacroUserIdStr<'_>,
        query: crate::domain::collection::CollectionQuery,
    ) -> Result<crate::domain::collection::ReminderCollectionPage, ReminderError> {
        self.generic.list_collection(user, query).await
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
    async fn create_reminder(
        &self,
        user: &MacroUserIdStr<'_>,
        request: CreateReminder,
        receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> Result<Reminder, ReminderError> {
        self.generic.create_reminder(user, request, receipt).await
    }
    async fn get_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Reminder, ReminderError> {
        self.generic.get_reminder(receipt).await
    }
    async fn list_reminders(
        &self,
        user: &MacroUserIdStr<'_>,
        filter: ReminderFilter,
    ) -> Result<ReminderPage, ReminderError> {
        self.generic.list_reminders(user, filter).await
    }
    async fn list_reminders_for_soup(
        &self,
        _user: &MacroUserIdStr<'_>,
        _query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, ReminderError> {
        Ok(Vec::new())
    }
    async fn update_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        mut patch: ReminderPatch,
    ) -> Result<Reminder, ReminderError> {
        let (user, id) = receipt_owner_and_id(&receipt)?;
        let Some(record) = self.email.repo.reminder_followup(&user, id).await? else {
            return self.generic.update_reminder(receipt, patch).await;
        };
        let _guard = self
            .email
            .repo
            .lock_followup(&user, record.followup.thread_id)
            .await?;
        let record = self
            .email
            .repo
            .reminder_followup(&user, id)
            .await?
            .ok_or(ReminderError::NotFound)?;
        if patch.enabled == Some(true) || patch.completed == Some(false) {
            return Err(ReminderError::BadRequest(
                "Use Remind me on the email to schedule it again".into(),
            ));
        }
        if let Some(schedule) = patch.schedule.take() {
            let ReminderSchedule::Once { remind_at } = schedule else {
                return Err(ReminderError::BadRequest(
                    "Email follow-ups cannot repeat".into(),
                ));
            };
            if patch.enabled == Some(false) || patch.completed == Some(true) {
                return Err(ReminderError::BadRequest(
                    "Reschedule or remove the email reminder separately".into(),
                ));
            }
            self.email
                .execute_locked(
                    user.clone(),
                    record.followup.thread_id,
                    EmailFollowupCommand::Set {
                        operation_id: Uuid::now_v7(),
                        expected_revision: Some(record.followup.revision),
                        remind_at,
                        condition: record.followup.condition,
                    },
                )
                .await?;
        }
        if patch.enabled == Some(false) || patch.completed == Some(true) {
            self.email.retire_locked(record).await?;
            patch.enabled = None;
            patch.completed = None;
        }
        if patch.is_empty() {
            self.generic.get_reminder(receipt).await
        } else {
            self.generic.update_reminder(receipt, patch).await
        }
    }
    async fn delete_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ReminderError> {
        let (user, id) = receipt_owner_and_id(&receipt)?;
        let Some(record) = self.email.repo.reminder_followup(&user, id).await? else {
            return self.generic.delete_reminder(receipt).await;
        };
        let _guard = self
            .email
            .repo
            .lock_followup(&user, record.followup.thread_id)
            .await?;
        let record = self
            .email
            .repo
            .reminder_followup(&user, id)
            .await?
            .ok_or(ReminderError::NotFound)?;
        self.email.retire_locked(record).await?;
        // Keep the tombstone and request identities: a delayed create retry must
        // not schedule another follow-up after removal.
        Ok(())
    }
}
