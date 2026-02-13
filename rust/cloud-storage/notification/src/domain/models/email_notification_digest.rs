//! Email notification digest decision logic.
//!
//! This module implements a state machine for determining whether to send
//! email notifications, following the decision flow:
//! 1. Check if notification type is blocked (e.g., new_email notifications)
//! 2. Check if user has a Macro account
//! 3. If no account: decide between single send (for invites) or batch send
//! 4. If account exists: check push notification settings

use crate::domain::models::{
    Notification, TaggedContent, UserNotificationRow,
    email_notification_digest::ports::{
        DigestBatcher, LastOnlineChecker, PushNotificationChecker, UserExistenceChecker,
    },
};
use either::Either;
use macro_user_id::cowlike::CowLike;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};

/// Port traits for external dependencies (user existence, push notification checks).
pub mod ports;

#[cfg(test)]
mod test;

/// Send as part of a batched digest email (collected over 5-30 minutes).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BatchSend<T>(T);

/// Send immediately as a single notification email.
pub struct SingleSend<T>(T);

/// Do not send an email for this notification.
pub struct DontSend(());

struct NotificationSet(HashSet<&'static str>);

/// trait used to create a set of notifications.
/// implemented by [EmailBlockList] and [ExplicitInviteAllowList]
pub trait NotificationSetBuilder {
    /// create a new instance of self, blocking notifications of a specific value
    /// from being sent via email digest
    fn new<T: Notification>() -> Self;

    /// append another value to the block list
    fn append<T: Notification>(self) -> Self;
}

impl NotificationSetBuilder for NotificationSet {
    /// create a new instance of self, blocking notifications of a specific value
    /// from being sent via email digest
    fn new<T: Notification>() -> Self {
        Self([T::TYPE_NAME].into())
    }

    /// append another value to the block list
    fn append<T: Notification>(mut self) -> Self {
        self.0.insert(T::TYPE_NAME);
        self
    }
}

impl NotificationSet {
    fn is_member<T: Notification>(&self) -> bool {
        self.0.contains(&T::TYPE_NAME)
    }
}

#[cfg_attr(feature = "docs", aquamarine::aquamarine)]
/// A set of notification types that should never trigger email notifications.
///
/// For example, `new_email` notifications are blocked since users already
/// received the email in their inbox.
///
/// # Decision Flow
///
/// ```mermaid
/// flowchart TD
///     Start["Send email for notification?"]
///     IsNewEmail{"Is new_email notification?"}
///     HasAccount{"Has Macro account?"}
///     HasPush{"Push notifications on?"}
///     IsOnline{"Online recently?"}
///     GotPush{"Got push notification?"}
///     IsInvite{"Explicit invite?"}
///
///     DontSend(["DON'T SEND"]):::red
///     Send(["SEND"]):::green
///     BatchSend(["BATCH SEND"]):::blue
///
///     Start --> IsNewEmail
///     IsNewEmail -->|NO| HasAccount
///     IsNewEmail -->|YES| DontSend
///
///     HasAccount -->|YES| HasPush
///     HasAccount -->|NO| IsInvite
///
///     HasPush -->|NO| IsOnline
///     HasPush -->|YES| GotPush
///
///     IsOnline -->|YES| DontSend
///     IsOnline -->|NO| BatchSend
///
///     GotPush -->|YES| DontSend
///     GotPush -->|NO| BatchSend
///
///     IsInvite -->|YES| Send
///     IsInvite -->|NO| BatchSend
///
///     classDef red fill:#8B0000,stroke:#FF6B6B,color:#fff
///     classDef green fill:#006400,stroke:#90EE90,color:#fff
///     classDef blue fill:#00008B,stroke:#6495ED,color:#fff
/// ```
pub struct EmailBlockList(NotificationSet);

impl NotificationSetBuilder for EmailBlockList {
    fn new<T: Notification>() -> Self {
        Self(NotificationSet::new::<T>())
    }

    fn append<T: Notification>(self) -> Self {
        Self(NotificationSet::append::<T>(self.0))
    }
}

impl EmailBlockList {
    /// Check if a notification type is allowed to trigger an email.
    ///
    /// Returns [`Decision::DontSend`] if the notification type is blocked,
    /// or [`Decision::Next`] with an [`AllowedNotification`] to continue the flow.
    pub fn notification_is_allowed<T: Notification>(
        &self,
        notif: UserNotificationRow<T>,
    ) -> Either<AllowedNotification<T>, DontSend> {
        match self.0.is_member::<T>() {
            true => Either::Right(DontSend(())),
            false => Either::Left(AllowedNotification { inner: notif }),
        }
    }
}

/// represents a notification that is allowed to be sent as part of a [EmailSendDecision]
pub struct AllowedNotification<T> {
    inner: UserNotificationRow<T>,
}

/// State indicating the notification recipient has a Macro account.
///
/// Next step: check if push notifications are enabled.
pub struct AccountExists<T> {
    prev: AllowedNotification<T>,
}

/// State indicating the notification recipient does not have a Macro account.
///
/// Next step: decide between single send (for invites) or batch send.
pub struct AccountDoesNotExist<T> {
    prev: AllowedNotification<T>,
}

impl<T: Notification> AllowedNotification<T> {
    /// Check if the notification recipient has a Macro account.
    ///
    /// Returns [`AccountExists`] if the user has an account (check push settings next),
    /// or [`AccountDoesNotExist`] if they don't (decide batch vs single send).
    pub async fn check_user_existence(
        self,
        checker: &impl UserExistenceChecker,
    ) -> Result<Either<AccountExists<T>, AccountDoesNotExist<T>>, Report> {
        let owner = self.inner.owner_id.copied();
        match checker.user_exists(owner).await {
            Ok(true) => Ok(Either::Left(AccountExists { prev: self })),
            Ok(false) => Ok(Either::Right(AccountDoesNotExist { prev: self })),
            Err(e) => Err(e),
        }
    }
}

/// A set of notification types that should be sent immediately (not batched).
///
/// These are typically invite notifications where timely delivery matters
/// more than batching for digest efficiency.
pub struct ExplicitInviteAllowList(NotificationSet);

impl NotificationSetBuilder for ExplicitInviteAllowList {
    fn new<T: Notification>() -> Self {
        Self(NotificationSet::new::<T>())
    }

    fn append<T: Notification>(self) -> Self {
        Self(NotificationSet::append::<T>(self.0))
    }
}

/// type alias for the data returned from [AccountDoesNotExist::batch_or_single_send]
pub type EmailSendDecision<T> = Either<SingleSend<T>, BatchSend<T>>;
impl<T: Notification> AccountDoesNotExist<T> {
    /// Decide whether to send immediately or batch for digest.
    ///
    /// Returns [`EmailSendDecision::SingleSend`] for explicit invite notifications,
    /// or [`EmailSendDecision::BatchSend`] for all other notification types.
    pub fn batch_or_single_send(
        self,
        invite_list: &ExplicitInviteAllowList,
    ) -> EmailSendDecision<UserNotificationRow<T>> {
        match invite_list.0.is_member::<T>() {
            true => EmailSendDecision::Left(SingleSend(self.prev.inner)),
            false => EmailSendDecision::Right(BatchSend(self.prev.inner)),
        }
    }
}

/// State indicating the user has push notifications enabled.
///
/// If push was delivered successfully, don't send email. Otherwise, batch send.
#[derive(Debug, Serialize, Deserialize)]
pub struct PushNotificationsEnabled {
    /// the inner value which has become adjacently tagged
    /// We lose the compiler typing here because we need to store this value
    /// to be retrieved during the SNS event handling.
    /// The deserialization cannot handle some specific T it needs to handle the general case
    /// of some json value
    inner: UserNotificationRow<serde_json::Value>,
}

impl PushNotificationsEnabled {
    /// assert that the push notification was delivered
    /// We do not send the bulk email digest
    fn assert_delivered(self) -> DontSend {
        DontSend(())
    }

    /// assert that the push notification failed to deliver and therefore
    /// we should queue a bulk email notification
    fn assert_failed(self) -> BatchSend<UserNotificationRow<serde_json::Value>> {
        BatchSend(self.inner)
    }
}

/// State indicating the user has push notifications disabled.
///
/// Since they can't receive push, check if they're online before deciding.
pub struct PushNotificationsDisabled<T> {
    prev: AccountExists<T>,
}

impl<T: Notification> AccountExists<T> {
    /// Check if the user has push notifications enabled.
    ///
    /// Returns [`PushNotificationsEnabled`] to check if push was delivered,
    /// or [`PushNotificationsDisabled`] to check online status instead.
    pub async fn push_notifications_enabled(
        self,
        checker: &impl PushNotificationChecker,
    ) -> Result<Either<PushNotificationsEnabled, PushNotificationsDisabled<T>>, Report> {
        match checker
            .push_notification_enabled(self.prev.inner.owner_id.copied())
            .await
        {
            Ok(true) => Ok(Either::Left(PushNotificationsEnabled {
                inner: self.prev.inner.into_json().expect("serde json cannot fail"),
            })),
            Ok(false) => Ok(Either::Right(PushNotificationsDisabled { prev: self })),
            Err(e) => Err(e),
        }
    }
}

impl<T: Notification> PushNotificationsDisabled<T> {
    /// check if the user has been logged in more recently than the threshold for notifications
    /// If the user has been online within the time window then we do not send email notifications.
    /// If the user has not been online within the threshold then we queue the notification for batch delivery
    pub async fn check_last_online_time(
        self,
        checker: &impl LastOnlineChecker,
        threshold: Duration,
    ) -> Result<Either<BatchSend<UserNotificationRow<T>>, DontSend>, Report> {
        let last_online = checker
            .last_online_checker(self.prev.prev.inner.owner_id.copied())
            .await?;
        Ok(match last_online.cmp(&threshold) {
            std::cmp::Ordering::Less | std::cmp::Ordering::Equal => Either::Right(DontSend(())),
            std::cmp::Ordering::Greater => Either::Left(BatchSend(self.prev.prev.inner)),
        })
    }
}

/// a struct which is able to drive the state machine to a decision on a given notification
pub struct StateMachineDriver<U, N, O, B> {
    /// adapter which implements [UserExistenceChecker]
    pub user_checker: U,
    /// adapter which implements [PushNotificationChecker]
    pub notification_checker: N,
    /// adapter which implements [LastOnlineChecker]
    pub online_checker: O,
    /// adapter which allows inserting a notification for bulk digest email
    /// implements [DigestBatcher]
    pub digest_batcher: B,
    /// the blocklist for notifications which are never forwarded to bulk
    pub block_list: EmailBlockList,
    /// the allow list for checking if a notification is analagous to an "invite to macro" notification
    pub invite_list: ExplicitInviteAllowList,
    /// the window of time in which the digest emails are collected for before sending
    pub digest_window: Duration,
    /// the duration for how recently a user has been online
    /// used to abort sending a bulk email if the user is below the
    /// threshold
    pub online_duration_threshold: Duration,
}

/// the initial decision created during notification ingress
pub enum StateMachineInitialDecision<T> {
    /// we will not send a batch email
    DontSend(DontSend),
    /// we already queued a batch email to send
    BatchWasQueued(BatchSend<()>),
    /// we don't yet have the required information to know if we need to send a batch or not
    /// if a caller receives this message the enqueued push notification (if it exists) should contain this data.
    ///
    /// This allows the egress worker to continue the state machine after we know what the status
    /// of the push notification is.
    Indeterminate(BatchSend<PushNotificationsEnabled>),
    /// we should template the contained notification into an email to send immediately.
    /// The caller is responsible for templating this notification into an email and queuing it for delivery
    SendImmediate(SingleSend<UserNotificationRow<T>>),
}

impl<U, N, O, B> StateMachineDriver<U, N, O, B>
where
    U: UserExistenceChecker,
    N: PushNotificationChecker,
    O: LastOnlineChecker,
    B: DigestBatcher,
{
    /// given an input notification, drive the state machine to an initial decision about the notification.
    /// This attempts to handle as many cases internally as possible although the caller is responsible for picking up certain decisions.
    /// See [StateMachineInitialDecision] for more info.
    pub async fn ingest<T: Notification>(
        &self,
        notif: UserNotificationRow<T>,
    ) -> Result<StateMachineInitialDecision<T>, Report> {
        let allowed = match self.block_list.notification_is_allowed(notif) {
            Either::Left(l) => l,
            Either::Right(r) => {
                return Ok(StateMachineInitialDecision::DontSend(r));
            }
        };
        let push_notification_state = match allowed
            .check_user_existence(&self.user_checker)
            .await?
            .map_right(|r| r.batch_or_single_send(&self.invite_list))
        {
            Either::Left(l) => {
                l.push_notifications_enabled(&self.notification_checker)
                    .await?
            }
            Either::Right(Either::Left(rl)) => {
                return Ok(StateMachineInitialDecision::SendImmediate(rl));
            }
            Either::Right(Either::Right(rr)) => {
                return Ok(StateMachineInitialDecision::BatchWasQueued(
                    self.inner_store_batch(rr).await?,
                ));
            }
        };
        let last_online = match push_notification_state {
            Either::Left(l) => {
                return Ok(StateMachineInitialDecision::Indeterminate(BatchSend(l)));
            }
            Either::Right(r) => {
                r.check_last_online_time(&self.online_checker, self.online_duration_threshold)
                    .await?
            }
        };
        Ok(match last_online {
            Either::Left(l) => {
                StateMachineInitialDecision::BatchWasQueued(self.inner_store_batch(l).await?)
            }
            Either::Right(r) => StateMachineInitialDecision::DontSend(r),
        })
    }

    async fn inner_store_batch<T: Notification>(
        &self,
        batch: BatchSend<UserNotificationRow<T>>,
    ) -> Result<BatchSend<()>, Report> {
        let notif = batch.0.into_tagged().map(TaggedContent::serialize);
        let () = self
            .digest_batcher
            .add_to_digest(&notif, self.digest_window)
            .await?;
        Ok(BatchSend(()))
    }
}
