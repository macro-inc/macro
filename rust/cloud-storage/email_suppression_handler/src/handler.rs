use anyhow::Context;
use aws_lambda_events::event::sns::SnsEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};

use crate::model::{
    BounceNotification, BounceSubType, BounceType, ComplaintFeedbackType, ComplaintNotification,
    EmailNotification, NotificationType,
};

#[tracing::instrument(skip(db, event))]
pub async fn handler(
    db: sqlx::Pool<sqlx::Postgres>,
    event: LambdaEvent<SnsEvent>,
) -> Result<(), Error> {
    // NOTE: may need to parallelize but at the moment it seems like we only get 1 record per event
    for event in event.payload.records {
        let message = event.sns.message;
        tracing::trace!(message=?message, "processing message");
        if let Err(e) = handle_email_notification(&db, &message).await {
            tracing::error!(error=?e, message=?message, "failed to handle email notification");
        }
    }

    Ok(())
}

/// Handles processing an email notification
#[tracing::instrument(skip(db, raw_notification))]
async fn handle_email_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    raw_notification: &str,
) -> anyhow::Result<()> {
    let notification: EmailNotification =
        serde_json::from_str(raw_notification).context("failed to deserialize message")?;

    match notification.notification_type {
        NotificationType::Complaint => {
            if let Some(complaint) = notification.complaint {
                handle_complaint_notification(db, &complaint).await
            } else {
                anyhow::bail!("expected complaint notification, got {:?}", notification)
            }
        }
        NotificationType::Bounce => {
            if let Some(bounce) = notification.bounce {
                handle_bounce_notification(db, &bounce).await
            } else {
                anyhow::bail!("expected bounce notification, got {:?}", notification)
            }
        }
    }
}

/// Handles processing a bounce notification
#[tracing::instrument(skip(db))]
async fn handle_bounce_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
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

            macro_db_client::blocked_email::bulk_upsert_block_email(db, &block_emails)
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
#[tracing::instrument(skip(db))]
async fn handle_complaint_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
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

        macro_db_client::blocked_email::bulk_upsert_block_email(db, &block_emails)
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

                macro_db_client::blocked_email::bulk_upsert_block_email(db, &block_emails)
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
