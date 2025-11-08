#![allow(warnings, reason = "waiting on #1805 to be merged")]
use std::collections::{HashMap, HashSet};

use anyhow::Context;
use env::SENDER_ADDRESS;
use futures::StreamExt;
use macro_entrypoint::MacroEntrypoint;
use macro_env::{Environment, ext::frontend_url::FrontendUrl};
use model_notifications::NotificationEventType;
use notification_db_client::user_notification::get::unsent::UnsentNotification;
use sqlx::postgres::PgPoolOptions;
use url::Url;

mod env;

#[cfg(test)]
mod poller_tests;

/// Handles polling notifications db for users that have unread channel notifications
#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = NotificationEmailPollerWorkerConfig::from_env()
        .context("expected to be able to generate config")?;

    tracing::trace!("initialized config");

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 50),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    // Normal config for non-local stack items
    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let ses_client = ses_client::Ses::new(
        aws_sdk_sesv2::Client::new(&aws_config),
        &config.environment.to_string(),
    );

    let notification_event_types = vec![
        NotificationEventType::ChannelMessageSend,
        NotificationEventType::ChannelMessageReply,
    ];

    process_unsent_notifications_for_users(
        &ses_client,
        &db,
        &notification_event_types,
        config.unsent_notification_limit,
        config.hours_ago,
    )
    .await?;

    Ok(())
}

async fn process_unsent_notifications_for_users(
    ses_client: &ses_client::Ses,
    db: &sqlx::Pool<sqlx::Postgres>,
    notification_event_types: &[NotificationEventType],
    limit: i64,
    hours_ago: f64,
) -> anyhow::Result<()> {
    let mut offset = 0;
    let env = Environment::new_or_prod();

    loop {
        // Get the list of unsent notifications for users and a given channel
        // NOTE: there is a chance you email a user about unread notifications in 1 loop but get
        // more unreads from them in the next. We need to ensure we check if we should email the
        // user **EVERY** time.
        let unsent_notifications = notification_db_client::user_notification::get::unsent::get_unsent_notifications_for_users(
            db,
            notification_event_types,
            limit,
            offset,
            hours_ago,
        )
        .await.context("failed to get unsent notifications")?;

        if unsent_notifications.is_empty() {
            break;
        }

        // Filter out invalid emails and emails with aliases in dev
        let unsent_notifications = unsent_notifications
            .into_iter()
            .filter(|notification| {
                let email = notification.user_id.replace("macro|", "");
                if !email_validator::is_valid_email(&email) {
                    tracing::warn!(notification=?notification, "invalid email {}", email);
                    false
                } else {
                    match env {
                        Environment::Develop | Environment::Local => {
                            // In dev, we don't want to spam all our our alias emails with
                            // notifications
                            if email.contains("+") {
                                tracing::debug!("invalid email {}", email);
                                false
                            } else {
                                true
                            }
                        }
                        Environment::Production => true,
                    }
                }
            })
            .collect::<Vec<UnsentNotification>>();

        // Filter out users that have notification email sent already
        let notification_email_sent_user_ids =
            notification_db_client::notification_email_sent::get::get_notification_email_sent_bulk(
                db,
                &unsent_notifications
                    .iter()
                    .map(|n| n.user_id.clone())
                    .collect::<Vec<String>>(),
            )
            .await
            .context("unable to get notification email sent user ids")?;

        let unsent_notifications = unsent_notifications
            .into_iter()
            .filter(|notification| {
                if notification_email_sent_user_ids.contains(&notification.user_id) {
                    tracing::debug!("notification email sent user id");
                    false
                } else {
                    true
                }
            })
            .collect::<Vec<UnsentNotification>>();

        // Filter out users that have notifications muted
        let muted_users =
            notification_db_client::user_mute_notification::get_user_mute_notification_bulk(
                db,
                &unsent_notifications
                    .iter()
                    .map(|n| n.user_id.clone())
                    .collect::<Vec<String>>(),
            )
            .await
            .context("unable to get muted users")?;

        let unsent_notifications = unsent_notifications
            .into_iter()
            .filter(|notification| {
                if muted_users.contains(&notification.user_id) {
                    tracing::debug!("muted user {}", notification.user_id);
                    false
                } else {
                    true
                }
            })
            .collect::<Vec<UnsentNotification>>();

        // Filter out emails that are unsubscribed
        let emails = unsent_notifications
            .iter()
            .map(|n| n.user_id.replace("macro|", ""))
            .collect::<Vec<String>>();
        // Get unsubscribed status for emails
        let email_unsubscribed =
            notification_db_client::unsubscribe::email::is_email_unsubscribed_batch(db, &emails)
                .await
                .context("unable to check if emails are unsubscribed")?;
        let email_unsubscribed: HashSet<String> = email_unsubscribed
            .into_iter()
            .filter_map(
                |(email, is_unsubscribed)| {
                    if is_unsubscribed { Some(email) } else { None }
                },
            )
            .collect();

        let unsent_notifications = unsent_notifications
            .into_iter()
            .filter(|notification| {
                let email = notification.user_id.replace("macro|", "");
                if email_unsubscribed.contains(&email) {
                    tracing::debug!("unsubscribed email {}", email);
                    false
                } else {
                    true
                }
            })
            .collect::<Vec<UnsentNotification>>();

        let mut user_notifications_map: HashMap<String, Vec<UnsentNotification>> = HashMap::new();

        for notification in unsent_notifications {
            let user_id = notification.user_id.clone();
            let notifications = user_notifications_map.entry(user_id).or_default();

            notifications.push(notification);
        }

        tracing::trace!(user_notifications_map=?user_notifications_map.keys(), "users unsent notifications");

        let result = futures::stream::iter(user_notifications_map.into_iter())
            .then(|(user_id, notifications)| async move {
                let result =
                    process_user_notifications(ses_client, db, &user_id, &notifications).await;

                match result {
                    Ok(()) => Ok(()),
                    Err(e) => Err((user_id, e)),
                }
            })
            .collect::<Vec<Result<(), (String, anyhow::Error)>>>()
            .await;

        for result in result {
            match result {
                Ok(()) => (),
                Err((user_id, e)) => {
                    tracing::error!(user_id=?user_id, error=?e, "unable to process user notifications")
                }
            }
        }

        offset += limit;
    }

    Ok(())
}

/// Processes a user's notifications
#[tracing::instrument(skip(ses_client, db, notifications))]
async fn process_user_notifications(
    ses_client: &ses_client::Ses,
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    notifications: &[UnsentNotification],
) -> anyhow::Result<()> {
    let start_time = std::time::Instant::now();
    let email = user_id.replace("macro|", "");
    tracing::trace!("processing notifications");

    // Filter out notifications where the channel id is in the `channel_notification_email_sent`
    let channel_ids = notifications
        .iter()
        .map(|n| n.event_item_id.clone())
        .collect::<Vec<String>>();
    tracing::trace!(channel_ids=?channel_ids, "got channel ids");

    let channel_notification_email_sent = notification_db_client::channel_notification_email_sent::get::get_channel_notification_email_sent_bulk_by_channel_ids(
        db,
        user_id,
        &channel_ids,
    ).await.context("unable to get channel notification email sent")?;

    let notifications = notifications
        .iter()
        .filter(|n| !channel_notification_email_sent.contains(&n.event_item_id))
        .collect::<Vec<&UnsentNotification>>();

    if notifications.is_empty() {
        tracing::debug!("no notifications to send");
        return Ok(());
    }

    // Filter out channels users have unsubscribed to
    let user_unsubscribes =
        notification_db_client::unsubscribe::get::get_user_unsubscribes(db, user_id)
            .await
            .context("unable to get user unsubscribes")?;
    tracing::trace!(user_unsubscribes=?user_unsubscribes, "got user unsubscribes");

    let user_unsubscribed_channel_ids = user_unsubscribes
        .iter()
        .filter_map(|unsubscribe| match unsubscribe.item_type.as_str() {
            "channel" => Some(unsubscribe.item_id.clone()),
            _ => None,
        })
        .collect::<HashSet<String>>();
    tracing::trace!(user_unsubscribed_channel_ids=?user_unsubscribed_channel_ids, "got user unsubscribed channel ids");

    let notifications = notifications
        .into_iter()
        .filter(|notification| {
            if user_unsubscribed_channel_ids.contains(&notification.event_item_id) {
                tracing::debug!(notification=?notification, "unsubscribed channel {}", notification.event_item_id);
                false
            } else {
                true
            }
        })
        .collect::<Vec<&UnsentNotification>>();

    if notifications.is_empty() {
        tracing::debug!("no notifications to send");
        return Ok(());
    }

    // Optimistically mark user as having sent email
    notification_db_client::notification_email_sent::create::create_notification_email_sent(
        db, user_id,
    )
    .await
    .context("unable to mark user as having sent email")?;
    tracing::trace!("notification email marked as sent");

    // Send email
    let macro_url = get_login_url(Environment::new_or_prod());

    let (email_content, subject) = fill_unread_message_template(&macro_url);

    ses_client
        .send_email(&SENDER_ADDRESS, &email, &subject, &email_content)
        .await
        .context("unable to send email")?;
    tracing::trace!("email sent");

    // Mark channel notification email sent for user
    notification_db_client::channel_notification_email_sent::upsert::upsert_channel_notification_email_sent_bulk_channel_ids(
        db,
        user_id,
        &channel_ids,
    )
    .await
    .context("unable to mark channel notification email sent")?;
    tracing::trace!("channel notification email marked as sent");

    // Mark notifications for event item ids as sent for user
    notification_db_client::user_notification::patch::sent::bulk_patch_sent_notification_event_item_ids(
        db,
        user_id,
        &channel_ids,
    ).await.context("unable to mark notifications as sent")?;

    tracing::trace!(elasped_time=?start_time.elapsed(), "start time");
    Ok(())
}

pub struct NotificationEmailPollerWorkerConfig {
    /// The connection URL for the Postgres database this application should use.
    pub database_url: String,

    /// The environment we are in
    pub environment: Environment,

    /// The sender base address
    #[allow(dead_code)]
    // Explicitly allowed as it's used to ensure we have a correct sender base address in the lazy env var above
    pub sender_base_address: String,

    /// The number of hours we will look back to find unsent notifications
    /// Defaults to 1 hour
    pub hours_ago: f64,

    /// The limit size for each batch of unsent notifications
    /// Defaults to 100
    pub unsent_notification_limit: i64,
}

fn get_login_url(env: Environment) -> Url {
    env.get_frontend_url().join("login").unwrap()
}

impl NotificationEmailPollerWorkerConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            std::env::var("DATABASE_URL").context("DATABASE_URL must be provided")?;

        let environment = Environment::new_or_prod();

        let sender_base_address =
            std::env::var("SENDER_BASE_ADDRESS").context("SENDER_BASE_ADDRESS must be provided")?;

        let hours_ago = std::env::var("HOURS_AGO")
            .unwrap_or("1".to_string())
            .parse::<f64>()
            .context("HOURS_AGO must be a valid number")?;

        let unsent_notification_limit = std::env::var("UNSENT_NOTIFICATION_LIMIT")
            .unwrap_or("100".to_string())
            .parse::<i64>()
            .context("UNSENT_NOTIFICATION_LIMIT must be a valid number")?;

        Ok(NotificationEmailPollerWorkerConfig {
            database_url,
            environment,
            sender_base_address,
            hours_ago,
            unsent_notification_limit,
        })
    }
}

static TEMPLATE: &str = include_str!("./templates/unread_message/_unread_message_template.html");

static SUBJECT: &str = "Macro Unread Message";

pub fn fill_unread_message_template(macro_url: &Url) -> (String, String) {
    let subject = SUBJECT;

    let content = TEMPLATE.replace("{{MACRO_URL}}", macro_url.as_str());

    (content, subject.to_string())
}
