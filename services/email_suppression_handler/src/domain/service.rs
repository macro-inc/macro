use anyhow::Context;

use super::{
    models::{
        BounceNotification, BounceSubType, BounceType, ComplaintFeedbackType, ComplaintNotification,
    },
    ports::{SuppressionService, SuppressionStore},
};

pub(crate) struct NotificationSuppression<R> {
    store: R,
}

impl<R> NotificationSuppression<R> {
    pub(crate) fn new(store: R) -> Self {
        Self { store }
    }
}

impl<R: SuppressionStore> SuppressionService for NotificationSuppression<R> {
    /// Handles processing a bounce notification
    #[tracing::instrument(skip(self))]
    async fn handle_bounce_notification(
        &self,
        notification: &BounceNotification,
    ) -> anyhow::Result<()> {
        tracing::info!("processing bounce notification");
        match notification.bounce_type {
            BounceType::Permanent => {
                tracing::info!("bounce type is permanent. adding to suppression list");
                let block_emails: Vec<&str> = notification
                    .bounced_recipients
                    .iter()
                    .map(|r| r.email_address.as_str())
                    .collect();

                self.store
                    .bulk_upsert_block_email(&block_emails)
                    .await
                    .context("failed to upsert block email")?;
            }
            BounceType::Transient => match notification.bounce_sub_type {
                BounceSubType::General => {
                    tracing::info!("bounce sub type is general");
                }
                BounceSubType::MailboxFull => {
                    tracing::info!("recipients mailbox is full");
                }
                BounceSubType::MessageTooLarge
                | BounceSubType::ContentRejected
                | BounceSubType::AttachmentRejected => {
                    tracing::info!("message content issue");
                }
                _ => unreachable!(),
            },
            BounceType::Undetermined => {
                tracing::info!("bounce type is undetermined");
            }
        }

        Ok(())
    }

    /// Handles processing a complaint notification
    #[tracing::instrument(skip(self))]
    async fn handle_complaint_notification(
        &self,
        notification: &ComplaintNotification,
    ) -> anyhow::Result<()> {
        tracing::info!("processing complaint notification");
        // If the complaint sub type is present, SES automatically supressed sending this email so we
        // should add to our block email list.
        if notification.complaint_sub_type.is_some() {
            tracing::info!("complaint sub type is present. adding to suppression list");
            let block_emails: Vec<&str> = notification
                .complained_recipients
                .iter()
                .map(|r| r.email_address.as_str())
                .collect();

            self.store
                .bulk_upsert_block_email(&block_emails)
                .await
                .context("failed to upsert block email")?;
            return Ok(());
        }

        if let Some(complaint_feedback_type) = notification.complaint_feedback_type.as_ref() {
            match complaint_feedback_type {
                ComplaintFeedbackType::Abuse
                | ComplaintFeedbackType::AuthFailure
                | ComplaintFeedbackType::Fraud
                | ComplaintFeedbackType::Virus
                | ComplaintFeedbackType::Other => {
                    tracing::info!("adding to suppression list");

                    let block_emails: Vec<&str> = notification
                        .complained_recipients
                        .iter()
                        .map(|r| r.email_address.as_str())
                        .collect();

                    self.store
                        .bulk_upsert_block_email(&block_emails)
                        .await
                        .context("failed to upsert block email")?;
                }
                ComplaintFeedbackType::NotSpam => {
                    tracing::info!("complaint feedback type is not spam. ignoring");
                }
            }
        } else {
            tracing::info!("complaint feedback type is not present. ignoring");
        }

        Ok(())
    }
}

#[cfg(test)]
mod test;
