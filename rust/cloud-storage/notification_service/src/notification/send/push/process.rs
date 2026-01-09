use crate::{
    config::APPLE_BUNDLE_ID,
    notification::send::push::{
        PushNotificationData,
        generate::{PlainTextFormatter, generate_apns_notification},
    },
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{
    DeviceEndpoint, DeviceType, HashedCollapseKey, NotificationWithRecipient,
};
use notification_db_client::notification::get::{BasicNotifRepoImpl, BasicNotificationRepo};
use sns_client::{MessageAttributes, NotificationSender, SnsTarget};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::mpsc::error::SendError;
use uuid::Uuid;

#[cfg(test)]
mod tests;

pub type NotificationsForDevices<'a> = HashMap<&'a NotificationWithRecipient, Vec<DeviceEndpoint>>;

async fn stream_push_notifs_to_user<'a>(
    worker: PushNotifWorker,
    notifs: NotificationsForDevices<'a>,
) {
    futures::stream::iter(
        notifs
            .into_iter()
            .flat_map(|(notif, devices)| devices.into_iter().map(move |d| (notif, d))),
    )
    .for_each_concurrent(10, move |(notif, endpoint)| {
        let worker = worker.clone();
        async move {
            let payload = match endpoint {
                DeviceEndpoint::Android(_) => {
                    tracing::warn!("android not implemented");
                    return;
                }
                DeviceEndpoint::Ios(_) => {
                    match generate_apns_notification::<PlainTextFormatter>(notif).transpose() {
                        Some(Ok(n)) => SnsTarget::Ios(Box::new(n)),
                        _ => return,
                    }
                }
            };
            let collapse_key = notif.inner.build_key().into_hashed();
            let _ = worker
                .enqueue(PushNotifMsg::Notify(NotifyData {
                    notification_id: notif.inner.id,
                    endpoint: endpoint.clone(),
                    payload,
                    attrs: sns_client::MessageAttributes {
                        push_type: sns_client::PushType::Alert,
                        apns_bundle_id: &APPLE_BUNDLE_ID,
                        collapse_key: collapse_key.clone().into_inner(),
                    },
                    notif_collapse_key: collapse_key,
                    recipient: notif.recipient_id.clone(),
                }))
                .await;
        }
    })
    .await;
}

#[derive(Clone)]
struct PushNotifWorker {
    inner: tokio::sync::mpsc::Sender<PushNotifMsg>,
}

impl PushNotifWorker {
    pub fn new<T: BasicNotificationRepo, U: NotificationSender>(
        sns_client: Arc<U>,
        repo: T,
    ) -> (
        Self,
        tokio::task::JoinHandle<HashSet<MacroUserIdStr<'static>>>,
    ) {
        let (tx, mut rx) = tokio::sync::mpsc::channel(100);
        let task = tokio::task::spawn(async move {
            let mut users_sent_push = HashSet::new();

            while let Some(msg) = rx.recv().await {
                match msg {
                    PushNotifMsg::Notify(NotifyData {
                        notification_id,
                        endpoint,
                        payload,
                        attrs,
                        notif_collapse_key,
                        recipient,
                    }) => {
                        let Ok(_) = repo
                            .update_collapse_key(&notification_id, notif_collapse_key.as_ref())
                            .await
                        else {
                            continue;
                        };
                        let Ok(_) = sns_client
                            .push_notification(endpoint.arn(), &payload, attrs)
                            .await
                        else {
                            continue;
                        };
                        users_sent_push.insert(recipient);
                    }
                }
            }
            users_sent_push
        });

        (PushNotifWorker { inner: tx }, task)
    }

    #[tracing::instrument(err, skip(self))]
    async fn enqueue(&self, msg: PushNotifMsg) -> Result<(), SendError<PushNotifMsg>> {
        self.inner.send(msg).await
    }
}

#[derive(Debug)]
enum PushNotifMsg {
    Notify(NotifyData),
}

#[derive(Debug)]
struct NotifyData {
    notification_id: Uuid,
    endpoint: DeviceEndpoint,
    payload: SnsTarget<PushNotificationData>,
    attrs: MessageAttributes,
    notif_collapse_key: HashedCollapseKey,
    recipient: MacroUserIdStr<'static>,
}

/// Attempts to send push notifications to provided users
/// Returns a list of users who were sent push notifications.
#[tracing::instrument(skip(db, sns_client))]
pub async fn process_push_notifications(
    db: sqlx::Pool<sqlx::Postgres>,
    sns_client: Arc<sns_client::SNS>,
    notifications: &HashMap<MacroUserIdStr<'static>, Vec<NotificationWithRecipient>>,
) -> Result<HashSet<MacroUserIdStr<'static>>, anyhow::Error> {
    let user_ids: Vec<_> = notifications.keys().cloned().collect();

    let user_device_endpoints =
        notification_db_client::device::get_users_device_endpoints(&db, user_ids.as_slice())
            .await?;

    process_push_notifications_inner(
        user_device_endpoints,
        notifications,
        sns_client,
        BasicNotifRepoImpl(db),
    )
    .await
}

async fn process_push_notifications_inner<U: NotificationSender, T: BasicNotificationRepo>(
    mut user_device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<(String, DeviceType)>>,
    notifications: &HashMap<MacroUserIdStr<'static>, Vec<NotificationWithRecipient>>,
    sns_client: Arc<U>,
    notif_repo: T,
) -> Result<HashSet<MacroUserIdStr<'static>>, anyhow::Error> {
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

    let (worker, handle) = PushNotifWorker::new(sns_client, notif_repo);

    stream_push_notifs_to_user(worker, to_send).await;

    let users_sent_push = handle.await.unwrap_or_default();

    Ok(users_sent_push)
}
