//! Core notification service implementation.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::ResultExt;
use rootcause::{Report, report};
use thiserror::Error;
use uuid::Uuid;

use crate::domain::models::{
    DeliveryStatus, ExclusionReason, FilteredRecipients, Notification, NotificationResult,
    RecipientExclusion, RevokeCriteria, SendNotificationRequest,
};
use crate::domain::ports::{
    EmailSender, NotificationRepository, NotificationSender, RateLimitPort, WebSocketSender,
};

/// Error returned when sending a notification fails.
#[derive(Debug, Error)]
pub enum SendNotificationError {
    /// Rate limit was exceeded.
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    /// Invalid rate limit config, either a key was provided but a key was not, or vice versa
    #[error("Rate limit config error")]
    RateLimitConfigErr,
    /// An internal error occurred.
    #[error("Internal error")]
    Other,
}

/// Error returned when revoke criteria has no filters set.
#[derive(Debug, Error)]
#[error("At least one filter must be set to revoke notifications")]
pub struct MissingRevokeFilter;

/// The core notification service that orchestrates sending notifications.
///
/// Generic over all port implementations to allow dependency injection.
pub struct NotificationService<R, N, W, M, E> {
    rate_limit: R,
    repository: N,
    websocket: W,
    mobile: M,
    email: E,
    service_name: String,
}

impl<R, N, W, M, E> NotificationService<R, N, W, M, E>
where
    R: RateLimitPort,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
{
    /// Create a new NotificationService with the given port implementations.
    pub fn new(
        rate_limit: R,
        repository: N,
        websocket: W,
        mobile: M,
        email: E,
        service_name: impl Into<String>,
    ) -> Self {
        Self {
            rate_limit,
            repository,
            websocket,
            mobile,
            email,
            service_name: service_name.into(),
        }
    }

    /// Send a notification to the specified recipients.
    ///
    /// This method performs the following steps:
    /// 1. Rate limit check (if a rate limit key is provided)
    /// 2. Filter recipients (remove sender, muted users, unsubscribed users)
    /// 3. Create notification in the database
    /// 4. Deliver via WebSocket, then push, then email
    /// 5. Update sent status
    pub async fn send_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: SendNotificationRequest<'a, T>,
    ) -> Result<NotificationResult, Report<SendNotificationError>> {
        let config = T::rate_limit_config();
        let key = request.notification.rate_limit_key();

        let rate_limit_key = match (config, key) {
            (Some(config), Some(key)) => Some((config, key)),
            (None, None) => None,
            (Some(_), None) | (None, Some(_)) => {
                return Err(report!(SendNotificationError::RateLimitConfigErr));
            }
        };

        // 1. Rate limit check (BEFORE any persistence)
        if let Some((config, key)) = rate_limit_key {
            let result = self
                .rate_limit
                .check_and_increment(key, config)
                .await
                .context(SendNotificationError::Other)?;
            if result.is_exceeded() {
                return Err(report!(SendNotificationError::RateLimitExceeded));
            }
        }

        // 2. Filter recipients
        let filtered = self
            .filter_recipients(
                request.sender_id.as_ref(),
                &request.recipient_ids,
                &request.notification_entity.entity_id,
            )
            .await
            .context(SendNotificationError::Other)?;

        if !filtered.has_valid_recipients() {
            // No valid recipients after filtering - return early with empty result
            return Ok(NotificationResult {
                notification_id: Uuid::now_v7(),
                notified_recipients: HashSet::new(),
                delivery_status: DeliveryStatus::default(),
            });
        }

        // 3. Create notification in DB
        let notification_id = Uuid::now_v7();
        let created = self
            .repository
            .create_notification(
                &request,
                notification_id,
                &self.service_name,
                &filtered.valid,
            )
            .await
            .context(SendNotificationError::Other)?;

        // If notification already exists (idempotent), return early
        let Some(notification_id) = created else {
            return Ok(NotificationResult {
                notification_id,
                notified_recipients: HashSet::new(),
                delivery_status: DeliveryStatus::default(),
            });
        };

        // 4. Deliver: WebSocket -> Push -> Email
        let delivery_status = self
            .deliver_notification(&request.notification, &filtered.valid)
            .await
            .context(SendNotificationError::Other)?;

        // 5. Update sent status for users who received via WebSocket or push
        let sent_users: Vec<_> = delivery_status
            .websocket_delivered
            .iter()
            .chain(delivery_status.push_delivered.iter())
            .cloned()
            .collect();

        if !sent_users.is_empty() {
            self.repository
                .update_sent_status(notification_id, &sent_users)
                .await
                .context(SendNotificationError::Other)?;
        }

        Ok(NotificationResult {
            notification_id,
            notified_recipients: filtered.valid_set_owned(),
            delivery_status,
        })
    }

    /// Revoke/delete notifications matching the given criteria.
    ///
    /// Returns the number of notifications deleted.
    pub async fn revoke_notifications<'a>(
        &self,
        criteria: RevokeCriteria<'a>,
    ) -> Result<u64, Report> {
        if !criteria.has_filter() {
            return Err(Report::new(MissingRevokeFilter).into());
        }

        self.repository.delete_notifications(&criteria).await
    }

    /// Filter recipients based on:
    /// - Sender (sender cannot receive their own notification)
    /// - Muted notifications
    /// - Unsubscribed from item
    async fn filter_recipients<'a>(
        &self,
        sender_id: Option<&MacroUserIdStr<'a>>,
        recipient_ids: &[MacroUserIdStr<'a>],
        item_id: &str,
    ) -> Result<FilteredRecipients<'a>, Report> {
        let mut valid: Vec<MacroUserIdStr<'a>> = Vec::new();
        let mut excluded: Vec<RecipientExclusion<'a>> = Vec::new();

        // First pass: remove sender
        for recipient in recipient_ids {
            if sender_id.is_some_and(|s| s == recipient) {
                excluded.push(RecipientExclusion {
                    user_id: recipient.clone(),
                    reason: ExclusionReason::IsSender,
                });
            } else {
                valid.push(recipient.clone());
            }
        }

        if valid.is_empty() {
            return Ok(FilteredRecipients { valid, excluded });
        }

        // Get muted users
        let muted_users = self.repository.get_muted_users(&valid).await?;

        // Get unsubscribed users
        let unsubscribed_users = self
            .repository
            .get_unsubscribed_users(item_id, &valid)
            .await?;

        // Second pass: filter muted and unsubscribed
        let mut final_valid = Vec::new();
        for recipient in valid {
            let recipient_static: MacroUserIdStr<'static> = recipient.clone().into_owned();

            if muted_users.contains(&recipient_static) {
                excluded.push(RecipientExclusion {
                    user_id: recipient,
                    reason: ExclusionReason::MutedNotifications,
                });
            } else if unsubscribed_users.contains(&recipient_static) {
                excluded.push(RecipientExclusion {
                    user_id: recipient,
                    reason: ExclusionReason::UnsubscribedFromItem,
                });
            } else {
                final_valid.push(recipient);
            }
        }

        Ok(FilteredRecipients {
            valid: final_valid,
            excluded,
        })
    }

    /// Deliver notification through all channels.
    async fn deliver_notification<'a, T: Notification + Send + Sync>(
        &self,
        notification: &T,
        recipients: &[MacroUserIdStr<'a>],
    ) -> Result<DeliveryStatus, Report> {
        let mut status = DeliveryStatus::default();

        // 1. Try WebSocket first
        let ws_notifications: Vec<_> = recipients
            .iter()
            .map(|r| (r.clone(), notification))
            .collect();

        let ws_delivered = self.websocket.send_notifications(ws_notifications).await?;
        status.websocket_delivered = ws_delivered.clone();

        // 2. For users not reached via WebSocket, try push notifications
        let not_ws: Vec<_> = recipients
            .iter()
            .filter(|r| {
                let static_id: MacroUserIdStr<'static> = (*r).clone().into_owned();
                !ws_delivered.contains(&static_id)
            })
            .cloned()
            .collect();

        if !not_ws.is_empty() {
            // Get device endpoints for remaining users
            let endpoints = self.repository.get_device_endpoints(&not_ws).await?;

            // TODO: Implement push notification sending using self.mobile
            // For now, we track which users have endpoints as "delivered"
            for (user_id, user_endpoints) in endpoints {
                if !user_endpoints.is_empty() {
                    status.push_delivered.insert(user_id);
                }
            }
        }

        // 3. For users still not reached, try email
        let not_pushed: Vec<_> = recipients
            .iter()
            .filter(|r| {
                let static_id: MacroUserIdStr<'static> = (*r).clone().into_owned();
                !ws_delivered.contains(&static_id) && !status.push_delivered.contains(&static_id)
            })
            .cloned()
            .collect();

        for recipient in not_pushed {
            // TODO: Check if this notification type should send email
            if let Ok(()) = self.email.send_email(notification, recipient.clone()).await {
                status.email_queued.insert(recipient.clone().into_owned());
            }
        }

        Ok(status)
    }
}
