use crate::{
    config::APPLE_BUNDLE_ID,
    notification::send::push::generate::{PlainTextFormatter, generate_apns_notification},
};
use aws_sdk_sns::operation::publish::PublishOutput;
use futures::{Stream, StreamExt};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{
    DeviceEndpoint, NotificationEvent, NotificationWithRecipient, UserNotification,
};
use sns_client::SnsTarget;
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
};

pub type NotificationsForDevices<'a> = HashMap<&'a NotificationWithRecipient, Vec<DeviceEndpoint>>;
pub type NotificationResult = (PublishOutput, MacroUserIdStr<'static>, DeviceEndpoint);

pub fn stream_push_notifs_to_user<'a>(
    sns_client: &'a sns_client::SNS,
    notifs: &'a NotificationsForDevices<'a>,
) -> impl Stream<Item = Result<NotificationResult, anyhow::Error>> + 'a {
    futures::stream::iter(
        notifs
            .iter()
            .flat_map(|(notif, devices)| devices.iter().map(move |d| (notif, d))),
    )
    .filter_map(
        async |(notif, endpoint)| -> Option<Result<NotificationResult, anyhow::Error>> {
            let payload = match endpoint {
                DeviceEndpoint::Android(_) => {
                    return Some(Err(anyhow::anyhow!("android not implemented")));
                }
                DeviceEndpoint::Ios(_) => {
                    match generate_apns_notification::<PlainTextFormatter>(notif).transpose()? {
                        Ok(n) => SnsTarget::Ios(Box::new(n)),
                        Err(e) => return Some(Err(anyhow::Error::from(e))),
                    }
                }
            };
            let res = sns_client
                .push_notification(
                    endpoint.arn(),
                    &payload,
                    sns_client::MessageAttributes {
                        push_type: sns_client::PushType::Alert,
                        apns_bundle_id: &APPLE_BUNDLE_ID,
                        collapse_key: notif.inner.build_key().into_hashed().into_inner(),
                    },
                )
                .await;
            let out: Result<NotificationResult, anyhow::Error> =
                res.map(|r| (r, notif.recipient_id.clone(), endpoint.clone()));
            Some(out)
        },
    )
}

/// Attempts to send push notifications to provided users
/// Returns a list of users who were sent push notifications.
#[tracing::instrument(skip(db, sns_client))]
pub async fn process_push_notifications(
    db: &sqlx::Pool<sqlx::Postgres>,
    sns_client: &sns_client::SNS,
    notifications: &HashMap<MacroUserIdStr<'static>, Vec<NotificationWithRecipient>>,
) -> Result<HashSet<MacroUserIdStr<'static>>, anyhow::Error> {
    let user_ids: Vec<_> = notifications.keys().cloned().collect();

    let mut user_device_endpoints =
        notification_db_client::device::get_users_device_endpoints(db, user_ids.as_slice()).await?;

    let to_send: HashMap<_, _> = notifications
        .iter()
        .flat_map(|(user_id, notifs)| {
            notifs
                .iter()
                .filter_map(|notif| {
                    let endpoints = user_device_endpoints.remove(user_id).map(|endpoints| {
                        endpoints
                            .into_iter()
                            .map(|(arn, device)| match device {
                                model_notifications::DeviceType::Ios => DeviceEndpoint::Ios(arn),
                                model_notifications::DeviceType::Android => {
                                    DeviceEndpoint::Android(arn)
                                }
                            })
                            .collect::<Vec<_>>()
                    })?;
                    Some((notif, endpoints))
                })
                .collect::<Vec<_>>()
        })
        .collect();

    let mut users_sent_push = HashSet::new();
    stream_push_notifs_to_user(sns_client, &to_send)
        .for_each_concurrent(10, |res| {
            if let Ok(r) = res.inspect_err(|e| tracing::error!("{e}")) {
                users_sent_push.insert(r.1);
            }
            async {}
        })
        .await;
    Ok(users_sent_push)
}
