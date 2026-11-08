//! Email notification digest decision logic.
//!
//! This module implements a state machine for determining whether to send
//! email notifications, following the decision flow:
//! 1. Check if notification type is blocked (e.g., new_email notifications)
//! 2. Check if user has a Macro account
//! 3. If no account: decide between single send (for invites) or batch send
//! 4. If account exists: check push notification settings

use crate::domain::{
    models::{
        Notification, NotificationTypeName, UserNotificationRow,
        email_notification_digest::ports::{
            DigestBatcher, LastOnlineChecker, MessageId, MessageReceiptRepo,
            NotificationSendChecker, PushNotificationChecker, UserExistenceChecker,
        },
    },
    ports::NotificationRepository,
};
use either::Either;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc, time::Duration};

/// Port traits for external dependencies (user existence, push notification checks).
pub mod ports;

#[cfg(test)]
mod test;

/// Send as part of a batched digest email (collected over a 24-hour window).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BatchSend<T>(T);

impl<T> BatchSend<T> {
    /// Borrow the inner value.
    pub(crate) fn inner(&self) -> &T {
        &self.0
    }

    /// Consume self and return the inner value.
    pub fn into_inner(self) -> T {
        self.0
    }
}

#[cfg(test)]
impl<T> BatchSend<T> {
    /// Wrap an inner value.
    pub(crate) fn from_inner(inner: T) -> Self {
        Self(inner)
    }
}

/// Do not send an email for this notification.
pub struct DontSend(());

#[cfg(test)]
impl DontSend {
    /// Create a new `DontSend` value (test-only).
    pub(crate) fn new() -> Self {
        Self(())
    }
}

struct NotificationSet(HashSet<&'static str>);

/// trait used to create a set of notifications.
/// implemented by [EmailBlockList]
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
    fn is_member(&self, typename: &NotificationTypeName) -> bool {
        self.0.contains(typename.as_ref())
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
///
///     DontSend(["DON'T SEND"]):::red
///     BatchSend(["BATCH SEND"]):::blue
///
///     Start --> IsNewEmail
///     IsNewEmail -->|NO| HasAccount
///     IsNewEmail -->|YES| DontSend
///
///     HasAccount -->|YES| HasPush
///     HasAccount -->|NO| DontSend
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
///     classDef red fill:#8B0000,stroke:#FF6B6B,color:#fff
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
    pub fn notification_is_allowed<T>(
        &self,
        notif: UserNotificationRow<Arc<T>>,
    ) -> Either<AllowedNotification<T>, DontSend> {
        match self.0.is_member(&notif.dangerous_get_typename()) {
            true => Either::Right(DontSend(())),
            false => Either::Left(AllowedNotification { inner: notif }),
        }
    }
}

/// A notification that has passed the block-list check and may proceed through the state machine.
pub struct AllowedNotification<T> {
    inner: UserNotificationRow<Arc<T>>,
}

/// State indicating the notification recipient has a Macro account.
///
/// Next step: check if push notifications are enabled.
pub struct AccountExists<T> {
    prev: AllowedNotification<T>,
}

impl<T> AllowedNotification<T> {
    /// Check if the notification recipient has a Macro account.
    ///
    /// Returns [`AccountExists`] if the user has an account (check push settings next),
    /// or [`DontSend`] if they don't (no account means skip email entirely).
    pub async fn check_user_existence(
        self,
        checker: &impl UserExistenceChecker,
    ) -> Result<Either<AccountExists<T>, DontSend>, Report> {
        let owner = self.inner.owner_id.copied();
        match checker.user_exists(owner).await {
            Ok(true) => Ok(Either::Left(AccountExists { prev: self })),
            Ok(false) => Ok(Either::Right(DontSend(()))),
            Err(e) => Err(e),
        }
    }
}

/// State indicating the user has push notifications enabled.
///
/// If push was delivered successfully, don't send email. Otherwise, batch send.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushNotificationsEnabled {
    /// the inner value which has become adjacently tagged
    /// We lose the compiler typing here because we need to store this value
    /// to be retrieved during the SNS event handling.
    /// The deserialization cannot handle some specific T it needs to handle the general case
    /// of some json value
    inner: UserNotificationRow<serde_json::Value>,
}

impl PushNotificationsEnabled {
    /// Get the owner (user) ID of this notification.
    pub(crate) fn owner_id(&self) -> &MacroUserIdStr<'static> {
        &self.inner.owner_id
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

impl<T: Serialize> AccountExists<T> {
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
                inner: self
                    .prev
                    .inner
                    .map(|v| serde_json::to_value(&*v).expect("serialization cannot fail")),
            })),
            Ok(false) => Ok(Either::Right(PushNotificationsDisabled { prev: self })),
            Err(e) => Err(e),
        }
    }
}

impl<T> PushNotificationsDisabled<T> {
    /// check if the user has been logged in more recently than the threshold for notifications
    /// If the user has been online within the time window then we do not send email notifications.
    /// If the user has not been online within the threshold then we queue the notification for batch delivery
    pub async fn check_last_online_time(
        self,
        checker: &impl LastOnlineChecker,
        threshold: Duration,
    ) -> Result<Either<BatchSend<UserNotificationRow<Arc<T>>>, DontSend>, Report> {
        let last_online = checker
            .last_online_checker(self.prev.prev.inner.owner_id.copied())
            .await?;
        Ok(match last_online.cmp(&threshold) {
            std::cmp::Ordering::Less | std::cmp::Ordering::Equal => Either::Right(DontSend(())),
            std::cmp::Ordering::Greater => Either::Left(BatchSend(self.prev.prev.inner)),
        })
    }
}

/// Port for driving the bulk-digest state machine to an initial decision.
///
/// This abstracts the concrete [`StateMachineDriverA`] so callers only depend on the capability,
/// not the specific implementation or its generic adapter parameters.
pub trait BulkDigestStateMachine: Send + Sync + 'static {
    /// Given an input notification, drive the state machine to an initial decision.
    ///
    /// See [`StateMachineDecisionA`] for the possible outcomes.
    fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        notif: UserNotificationRow<Arc<T>>,
    ) -> impl Future<Output = Result<StateMachineDecisionA, Report>> + Send;
}

/// a struct which is able to drive the state machine to a decision on a given notification
/// This state machine does not model the entire decision tree because it runs at a place in the program
/// where not all actions have been taken yet.
pub struct StateMachineDriverA<U, N, O, B> {
    /// Adapter which implements [UserExistenceChecker].
    pub user_checker: U,
    /// Adapter which implements [PushNotificationChecker].
    pub notification_checker: N,
    /// Adapter which implements [LastOnlineChecker].
    pub online_checker: O,
    /// Adapter which allows inserting a notification for bulk digest email.
    /// Implements [DigestBatcher].
    pub digest_batcher: B,
    /// The blocklist for notifications which are never forwarded to bulk.
    pub block_list: EmailBlockList,
    /// The window of time in which the digest emails are collected for before sending.
    pub digest_window: Duration,
    /// The duration for how recently a user has been online.
    /// Used to abort sending a bulk email if the user is below the threshold.
    pub online_duration_threshold: Duration,
}

impl<U, N, O, B> StateMachineDriverA<U, N, O, B> {
    /// Create a new instance with the default time windows (24-hour digest, 60 min online).
    pub fn new_with_defaults(
        user_checker: U,
        notification_checker: N,
        online_checker: O,
        digest_batcher: B,
        block_list: EmailBlockList,
    ) -> Self {
        Self {
            user_checker,
            notification_checker,
            online_checker,
            digest_batcher,
            block_list,
            digest_window: std::time::Duration::from_hours(24),
            online_duration_threshold: std::time::Duration::from_mins(60),
        }
    }
}

/// the initial decision created during notification ingress
pub enum StateMachineDecisionA {
    /// we will not send a batch email
    DontSend(DontSend),
    /// we already queued a batch email to send
    BatchWasQueued(BatchSend<()>),
    /// we don't yet have the required information to know if we need to send a batch or not
    /// if a caller receives this message the enqueued push notification (if it exists) should contain this data.
    ///
    /// This allows the egress worker to continue the state machine after we know what the status
    /// of the push notification is.
    Indeterminate(Box<BatchSend<PushNotificationsEnabled>>),
}

impl<U, N, O, B> StateMachineDriverA<U, N, O, B>
where
    U: UserExistenceChecker,
    N: PushNotificationChecker,
    O: LastOnlineChecker,
    B: DigestBatcher,
{
    /// given an input notification, drive the state machine to an initial decision about the notification.
    /// This attempts to handle as many cases internally as possible although the caller is responsible for picking up certain decisions.
    /// See [StateMachineInitialDecision] for more info.
    pub async fn ingest<T: Serialize>(
        &self,
        notif: UserNotificationRow<Arc<T>>,
    ) -> Result<StateMachineDecisionA, Report> {
        let allowed = match self.block_list.notification_is_allowed(notif) {
            Either::Left(l) => l,
            Either::Right(r) => {
                return Ok(StateMachineDecisionA::DontSend(r));
            }
        };
        let push_notification_state = match allowed.check_user_existence(&self.user_checker).await?
        {
            Either::Left(l) => {
                l.push_notifications_enabled(&self.notification_checker)
                    .await?
            }
            Either::Right(r) => {
                return Ok(StateMachineDecisionA::DontSend(r));
            }
        };
        let last_online = match push_notification_state {
            Either::Left(l) => {
                return Ok(StateMachineDecisionA::Indeterminate(Box::new(BatchSend(l))));
            }
            Either::Right(r) => {
                r.check_last_online_time(&self.online_checker, self.online_duration_threshold)
                    .await?
            }
        };
        Ok(match last_online {
            Either::Left(l) => {
                StateMachineDecisionA::BatchWasQueued(self.inner_store_batch(l).await?)
            }
            Either::Right(r) => StateMachineDecisionA::DontSend(r),
        })
    }

    async fn inner_store_batch<T: Serialize>(
        &self,
        batch: BatchSend<UserNotificationRow<Arc<T>>>,
    ) -> Result<BatchSend<()>, Report> {
        let notif = batch
            .0
            .map(|v| serde_json::to_value(&*v).expect("serialize cannot fail"));
        let () = self
            .digest_batcher
            .add_to_digest(&notif, self.digest_window)
            .await?;
        Ok(BatchSend(()))
    }
}

impl<U, N, O, B> BulkDigestStateMachine for StateMachineDriverA<U, N, O, B>
where
    U: UserExistenceChecker,
    N: PushNotificationChecker,
    O: LastOnlineChecker,
    B: DigestBatcher,
{
    fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        notif: UserNotificationRow<Arc<T>>,
    ) -> impl Future<Output = Result<StateMachineDecisionA, Report>> + Send {
        self.ingest(notif)
    }
}

/// This state machine driver is able to pick up at a different place in the program
/// Once we know what the delivery state of a push Notification to a users device is
pub struct StateMachineDriverB<B, R> {
    /// some R that implements [MessageReceiptRepo]
    pub message_receipt_repo: R,
    /// Some B that implements [DigestBatcher]
    pub digest_batcher: B,
    /// the window of time in which the digest emails are collected for before sending
    pub digest_window: Duration,
}

/// the request used to call [StateMachineDriverB::continue_machine]
pub struct ResumeMachineBRequest<N> {
    /// the notification enabled value as received from [StateMachineDecisionA::Indeterminate]
    pub notification_enabled: PushNotificationsEnabled,
    /// all endpoint send checkers for this user — implements [NotificationSendChecker]
    pub send_notifs: Vec<N>,
}

impl<B, R> StateMachineDriverB<B, R>
where
    B: DigestBatcher,
    R: MessageReceiptRepo,
{
    /// this picks up where we left off if we received a [StateMachineDecisionA::Indeterminate]
    /// We call this when its time to send the notification, on the egress side of the queue.
    ///
    /// Tries all endpoints for the user. Records message IDs for successes.
    /// Only queues a batch email digest if ALL endpoints fail.
    ///
    /// Returns a tuple of:
    /// - Per-endpoint results (for delivery status tracking)
    /// - `Left(DontSend)` if any succeeded, `Right(batch_result)` if all failed
    #[allow(clippy::type_complexity)]
    pub async fn continue_machine<N: NotificationSendChecker>(
        &self,
        req: ResumeMachineBRequest<N>,
    ) -> (
        Vec<Result<N::Ok, N::Err>>,
        Either<DontSend, Result<BatchSend<()>, Report>>,
    ) {
        let ResumeMachineBRequest {
            notification_enabled,
            send_notifs,
        } = req;

        let mut results = Vec::with_capacity(send_notifs.len());
        let mut any_succeeded = false;

        for send_notif in send_notifs {
            match send_notif.send_notification().await {
                Ok(r) => {
                    let message_id = N::extract_message_id(&r);
                    // cant really do anything if this fails, so we just ignore the error
                    let _ = self
                        .message_receipt_repo
                        .record_message_id(
                            message_id,
                            notification_enabled.inner.owner_id.copied(),
                            notification_enabled.inner.notification_id,
                        )
                        .await;
                    results.push(Ok(r));
                    any_succeeded = true;
                }
                Err(e) => {
                    results.push(Err(e));
                }
            }
        }

        if any_succeeded {
            (results, Either::Left(DontSend(())))
        } else {
            let next = notification_enabled.assert_failed();
            let batch_result = self
                .digest_batcher
                .add_to_digest(&next.0, self.digest_window)
                .await
                .map(BatchSend);
            (results, Either::Right(batch_result))
        }
    }
}

/// Port for continuing the bulk-digest state machine on the egress side.
///
/// This abstracts [`StateMachineDriverB`] so callers only depend on the capability,
/// not the specific implementation or its generic adapter parameters.
pub trait BulkDigestEgressStateMachine: Send + Sync + 'static {
    /// Try all endpoints for a user. Records message IDs for successes.
    /// Only queues a batch email digest if ALL endpoints fail.
    ///
    /// Returns per-endpoint results and either `DontSend` (any succeeded)
    /// or the batch result (all failed).
    #[allow(clippy::type_complexity)]
    fn continue_machine<N: NotificationSendChecker>(
        &self,
        req: ResumeMachineBRequest<N>,
    ) -> impl Future<
        Output = (
            Vec<Result<N::Ok, N::Err>>,
            Either<DontSend, Result<BatchSend<()>, Report>>,
        ),
    > + Send;
}

impl<B, R> BulkDigestEgressStateMachine for StateMachineDriverB<B, R>
where
    B: DigestBatcher,
    R: MessageReceiptRepo,
{
    fn continue_machine<N: NotificationSendChecker>(
        &self,
        req: ResumeMachineBRequest<N>,
    ) -> impl Future<
        Output = (
            Vec<Result<N::Ok, N::Err>>,
            Either<DontSend, Result<BatchSend<()>, Report>>,
        ),
    > + Send {
        self.continue_machine(req)
    }
}

/// the driver of the state machine which is used to reconcile the SNS failure messages
/// with the digests that should be sent due to failure
pub struct StateMachineDriverC<B, R, N> {
    /// some R that implements [MessageReceiptRepo]
    pub message_receipt_repo: R,
    /// Some B that implements [DigestBatcher]
    pub digest_batcher: B,
    /// some N that implements [NotificationRepository]
    pub notif_repo: N,
    /// the window of time in which the digest emails are collected for before sending
    pub digest_window: Duration,
}

/// the outcome of a [StateMachineDriverC]
pub enum StateMachineDecisionC {
    /// No batch message was queued
    NoAction,
    /// the digest message was queued
    BatchWasQueued(BatchSend<()>),
}

impl<B, R, N> StateMachineDriverC<B, R, N>
where
    B: DigestBatcher,
    R: MessageReceiptRepo,
    N: NotificationRepository,
{
    /// mark a message as failed, this will enqueue messages to the batch only once all the
    /// push notifs for this user_notification have failed
    pub async fn mark_message_as_failed(
        &self,
        message_id: MessageId,
    ) -> Result<StateMachineDecisionC, Report> {
        let (user_id, notif_id) = self
            .message_receipt_repo
            .mark_message_failed(message_id)
            .await?;
        let did_all_pushes_fail = self
            .message_receipt_repo
            .did_all_messages_fail(user_id.copied(), notif_id)
            .await?;
        let true = did_all_pushes_fail else {
            return Ok(StateMachineDecisionC::NoAction);
        };

        // retrieve the notification data and add it to the batch
        let Some(notif) = self
            .notif_repo
            .get_user_notification_by_id::<serde_json::Value>(user_id.copied(), notif_id)
            .await?
        else {
            return Err(report!(
                "No user_notification was found for {} + {}",
                user_id,
                notif_id
            ));
        };

        let () = self
            .digest_batcher
            .add_to_digest(&notif, self.digest_window)
            .await?;
        Ok(StateMachineDecisionC::BatchWasQueued(BatchSend(())))
    }
}

/// Port for reconciling async SNS delivery failures with the digest batching system.
///
/// This abstracts [`StateMachineDriverC`] so callers only depend on the capability,
/// not the specific implementation or its generic adapter parameters.
pub trait BulkDigestFailureStateMachine: Send + Sync + 'static {
    /// Mark a push notification message as failed and, if all pushes for that
    /// user+notification have now failed, queue the notification for batch email digest.
    fn mark_message_as_failed(
        &self,
        message_id: MessageId,
    ) -> impl Future<Output = Result<StateMachineDecisionC, Report>> + Send;
}

impl<B, R, N> BulkDigestFailureStateMachine for StateMachineDriverC<B, R, N>
where
    B: DigestBatcher,
    R: MessageReceiptRepo,
    N: NotificationRepository,
{
    fn mark_message_as_failed(
        &self,
        message_id: MessageId,
    ) -> impl Future<Output = Result<StateMachineDecisionC, Report>> + Send {
        self.mark_message_as_failed(message_id)
    }
}
