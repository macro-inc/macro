//! Reminder emails for team invites nobody has answered: at most two per
//! invite, 3 days after the last email and then 4 days after that.

use std::collections::HashSet;

use channels::domain::ports::ChannelService;
use macro_event_broker::MacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use model_notifications::{InviteToTeamMetadata, InviteePlan};
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;

use super::TeamServiceImpl;
use crate::domain::{
    contacts_enqueuer::ContactsEnqueuer,
    crm_enqueuer::CrmEnqueuer,
    customer_repo::CustomerRepository,
    model::{DueInviteReminder, TeamError},
    open_seat_release::OpenSeatRelease,
    owned_entity_cleanup::OwnedEntityCleanup,
    team_analytics::TeamAnalytics,
    team_crm_settings_repo::TeamCrmSettingsRepository,
    team_repo::TeamRepository,
};

/// Most invites one sweep claims. A full batch means more may be due, so
/// the worker sweeps again right away.
pub const INVITE_REMINDER_BATCH: i64 = 100;

/// What one reminder sweep did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct InviteReminderReport {
    /// Invites whose reminder was due and claimed.
    pub claimed: usize,
    /// Reminders handed to the notification service.
    pub sent: usize,
    /// Reminders that could not be sent. They are not retried: the claim
    /// already counted them, so a failure costs a reminder, never doubles one.
    pub failed: usize,
}

/// Sends the reminder emails that are due.
pub trait InviteReminderSender: Send + Sync + 'static {
    /// Claims every invite whose reminder is due, up to
    /// [`INVITE_REMINDER_BATCH`], and emails each invitee.
    fn send_due_invite_reminders(
        &self,
    ) -> impl Future<Output = Result<InviteReminderReport, TeamError>> + Send;
}

/// The plan the reminder promises, following `invite_users_to_team` without
/// its subscription backfill, which a background sweep must not trigger. A
/// team whose owner's subscription is not linked yet reads as free, which
/// never promises more than joining grants.
fn invitee_plan(reminder: &DueInviteReminder) -> InviteePlan {
    if reminder.enterprise || (reminder.paying && reminder.has_subscription) {
        InviteePlan::Premium
    } else {
        InviteePlan::Free
    }
}

/// One notification id per invite and reminder, so delivering the same
/// reminder twice creates one notification.
fn reminder_notification_id(reminder: &DueInviteReminder) -> uuid::Uuid {
    uuid::Uuid::new_v5(
        &reminder.team_invite_id,
        format!("team-invite-reminder-{}", reminder.reminder_number).as_bytes(),
    )
}

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC> InviteReminderSender
    for TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    #[tracing::instrument(
        name = "teams.invite_reminder_sweep",
        skip(self),
        fields(claimed, sent, failed),
        err
    )]
    async fn send_due_invite_reminders(&self) -> Result<InviteReminderReport, TeamError> {
        let due = self
            .team_repository
            .claim_due_invite_reminders(INVITE_REMINDER_BATCH)
            .await?;

        let mut report = InviteReminderReport {
            claimed: due.len(),
            ..InviteReminderReport::default()
        };
        for reminder in &due {
            match self.send_invite_reminder(reminder).await {
                Ok(()) => report.sent += 1,
                Err(_) => report.failed += 1,
            }
        }

        let span = tracing::Span::current();
        span.record("claimed", report.claimed);
        span.record("sent", report.sent);
        span.record("failed", report.failed);
        Ok(report)
    }
}

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
    TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    /// Emails one reminder. Email only: the first invite already put a
    /// notification in the invitee's inbox if they have an account.
    #[tracing::instrument(
        name = "teams.send_invite_reminder",
        skip_all,
        fields(
            team_id = %reminder.team_id,
            team_invite_id = %reminder.team_invite_id,
            reminder_number = reminder.reminder_number,
            invitee_plan = ?invitee_plan(reminder),
        ),
        err
    )]
    async fn send_invite_reminder(&self, reminder: &DueInviteReminder) -> anyhow::Result<()> {
        let recipient = MacroUserIdStr::try_from_email(&reminder.email)
            .map_err(|e| anyhow::anyhow!("invalid invitee email: {e:?}"))?;
        let invited_by = MacroUserIdStr::parse_from_str(&reminder.invited_by)
            .map_err(|e| anyhow::anyhow!("invalid inviter id: {e:?}"))?
            .into_owned();

        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team
                .with_entity_string(reminder.team_invite_id.to_string()),
            secondary_notification_entity: None,
            sender_id: Some(invited_by.clone()),
            notification: InviteToTeamMetadata {
                team_id: reminder.team_id,
                team_invite_id: reminder.team_invite_id,
                invited_by,
                team_name: reminder.team_name.clone(),
                role: None,
                sender_profile_picture_url: None,
                invitee_plan: invitee_plan(reminder),
                reminder: true,
            },
            recipient_ids: HashSet::from([recipient]),
        }
        .into_request_with_id(reminder_notification_id(reminder))
        .with_email();

        self.notification_ingress
            .send_notification(request)
            .await
            .map_err(|e| anyhow::anyhow!("failed to send notification: {e}"))?;
        Ok(())
    }
}
