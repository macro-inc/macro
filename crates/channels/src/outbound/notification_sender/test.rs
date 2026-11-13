use super::*;
use macro_user_id::cowlike::CowLike;
use model_entity::Entity;
use models_pagination::{CreatedAt, Paginated, Query};
use notification_hex::domain::models::{
    DisabledNotificationType, UserNotificationRow,
    device::DeviceType,
    request::{GetNotificationsByEventItemIdsRequest, UpdateNotificationsForEntitiesRequest},
};
use notification_hex::domain::{
    models::{
        Notification, SendNotificationRequest, queue_message::IngressQueueMessage,
        request::NotificationResult,
    },
    service::SendNotificationError,
};
use rootcause::Report;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
struct CapturingIngress {
    sent: Mutex<Vec<Value>>,
}

impl NotificationIngress for CapturingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        self.sent.lock().unwrap().push(
            serde_json::to_value(IngressQueueMessage::from_request(&req).unwrap().request).unwrap(),
        );
        Ok(None)
    }
}

#[tokio::test]
async fn invite_delivery_preserves_dm_context_for_email_and_push() {
    for channel_type in [
        ChannelType::DirectMessage,
        ChannelType::Private,
        ChannelType::Team,
        ChannelType::Public,
    ] {
        let is_dm = matches!(channel_type, ChannelType::DirectMessage);
        let channel_name = if is_dm {
            "julia+scribbington"
        } else {
            "general"
        };
        let ingress = Arc::new(CapturingIngress::default());
        let channel_id = Uuid::from_u128(1);
        let sender = MacroUserIdStr::try_from_email("sender@example.com").unwrap();
        let registered = MacroUserIdStr::try_from_email("registered@example.com").unwrap();
        let unregistered =
            MacroUserIdStr::try_from_email("julia+scribbington@example.com").unwrap();

        NotificationChannelSender::new(ingress.clone())
            .send(ChannelNotificationEffect::Invite {
                message_id: Some(Uuid::from_u128(2)),
                channel_id,
                invited_by_user_id: sender,
                registered_recipient_ids: HashSet::from([registered.clone()]),
                unregistered_recipient_ids: HashSet::from([unregistered.clone()]),
                sender_profile_picture_url: None,
                message_content: Some("Hey".to_string()),
                metadata: ChannelMetadata {
                    channel_type,
                    channel_name: channel_name.to_string(),
                },
            })
            .await
            .unwrap();

        let sent = ingress.sent.lock().unwrap();
        assert_eq!(sent.len(), 2);
        for request in sent.iter() {
            let notification = &request["req"]["notification"];
            assert_eq!(notification["tag"], "channel_invite");
            assert_eq!(notification["content"]["isDirectMessage"], is_dm);
            assert_eq!(notification["content"]["channelName"], channel_name);
            assert_eq!(notification["content"]["messageContent"], "Hey");
            assert_eq!(
                request["req"]["notification_entity"]["entity_id"],
                channel_id.to_string()
            );
        }

        let email = sent
            .iter()
            .find(|req| !req["build_email"].is_null())
            .unwrap();
        assert_eq!(email["req"]["recipient_ids"], json!([unregistered]));
        assert!(email["build_apns"].is_null());
        assert_eq!(email["send_conn_gateway"], false);
        assert!(
            email["req"]["notification"]["content"]
                .get("messageId")
                .is_none()
        );
        assert!(
            email["req"]["notification"]["content"]
                .get("emailRecipient")
                .is_none()
        );
        let email_content = &email["build_email"]["content"];
        assert_eq!(
            email_content["subject"],
            if is_dm {
                "sender@example.com sent you a message on Macro"
            } else {
                "sender@example.com has invited you to join #general"
            }
        );
        let body = email_content["body"].as_str().unwrap();
        assert!(body.contains("Hey"));
        if is_dm {
            assert!(!body.contains(channel_name));
            assert!(body.contains(">View message</a"));
        } else {
            assert!(body.contains("<strong>#general</strong>"));
            assert!(body.contains(">Join channel</a"));
        }

        let push = sent
            .iter()
            .find(|req| !req["build_apns"].is_null())
            .unwrap();
        assert_eq!(push["req"]["recipient_ids"], json!([registered]));
        assert_eq!(push["send_conn_gateway"], true);
        assert_eq!(
            push["build_apns"]["notif"]["aps"]["alert"]["title"],
            if is_dm {
                "sender@example.com sent you a message"
            } else {
                "sender@example.com invited you to join #general"
            }
        );
    }
}

#[tokio::test]
async fn dm_email_delivery_keys_are_per_recipient_and_stable_on_retry() {
    let ingress = Arc::new(CapturingIngress::default());
    let effect = ChannelNotificationEffect::Invite {
        channel_id: Uuid::new_v4(),
        message_id: Some(Uuid::new_v4()),
        invited_by_user_id: MacroUserIdStr::try_from_email("sender@example.com").unwrap(),
        registered_recipient_ids: HashSet::new(),
        unregistered_recipient_ids: HashSet::from([
            MacroUserIdStr::try_from_email("one@example.com").unwrap(),
            MacroUserIdStr::try_from_email("two@example.com").unwrap(),
        ]),
        sender_profile_picture_url: None,
        message_content: Some("hello".to_string()),
        metadata: ChannelMetadata {
            channel_type: ChannelType::DirectMessage,
            channel_name: "Direct message".to_string(),
        },
    };
    let sender = NotificationChannelSender::new(ingress.clone());
    sender.send(effect.clone()).await.unwrap();
    sender.send(effect).await.unwrap();
    let sent = ingress.sent.lock().unwrap();
    let emails: Vec<_> = sent
        .iter()
        .filter(|req| !req["build_email"].is_null())
        .collect();
    assert_eq!(emails.len(), 4);
    assert_ne!(
        emails[0]["build_email"]["rate_limit_key"],
        emails[1]["build_email"]["rate_limit_key"]
    );
    for email in &emails[..2] {
        let retried = emails[2..]
            .iter()
            .find(|retry| retry["req"]["recipient_ids"] == email["req"]["recipient_ids"])
            .unwrap();
        assert_eq!(
            email["build_email"]["rate_limit_key"],
            retried["build_email"]["rate_limit_key"]
        );
    }
}

#[derive(Default)]
struct FailingFirstReader {
    attempts: Mutex<Vec<(MacroUserIdStr<'static>, Uuid)>>,
}

impl NotificationReader for FailingFirstReader {
    fn update_notifications(
        &self,
        req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async move {
            assert!(matches!(req.status, NotificationStatus::Done(true)));
            assert_eq!(req.notification_ids.len(), 1);
            let mut attempts = self.attempts.lock().unwrap();
            attempts.push((req.user_id.into_owned(), req.notification_ids[0]));
            if attempts.len() == 1 {
                return Err(rootcause::report!("first recipient update failed"));
            }
            Ok(())
        }
    }

    fn update_notifications_and_return<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn update_notifications_for_entities<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsForEntitiesRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: Option<u32>,
        _cursor: Query<Uuid, CreatedAt, ()>,
        _filters: notification_hex::domain::models::request::NotificationListFilters,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!("only completion updates are expected") }
    }

    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        _req: GetNotificationsByEventItemIdsRequest<'_>,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!("only completion updates are expected") }
    }

    fn get_entity_notifications_batch<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _entity_refs: Vec<Entity<'static>>,
        _query: notification_hex::domain::models::entity_query::EntityNotificationQuery,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, Vec<UserNotificationRow<T>>>, Report>> + Send
    {
        async { unreachable!("only completion updates are expected") }
    }

    fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<Option<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn delete_user_notification(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn bulk_delete_user_notifications(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn register_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
        _native_call_capable: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn unregister_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn get_disabled_notification_types(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn disable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }

    fn enable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("only completion updates are expected") }
    }
}

#[derive(Default)]
struct CapturingWithdrawal {
    ids: Mutex<Vec<Uuid>>,
}

impl NotificationWithdrawal for CapturingWithdrawal {
    async fn withdraw(&self, notification_id: Uuid) -> Result<(), Report> {
        self.ids.lock().unwrap().push(notification_id);
        Ok(())
    }
}

#[tokio::test]
async fn completion_continues_after_a_recipient_failure() {
    let reader = Arc::new(FailingFirstReader::default());
    let withdrawal = Arc::new(CapturingWithdrawal::default());
    let notification_id = Uuid::now_v7();
    let recipients = HashSet::from([
        MacroUserIdStr::try_from_email("first@example.com").unwrap(),
        MacroUserIdStr::try_from_email("second@example.com").unwrap(),
        MacroUserIdStr::try_from_email("third@example.com").unwrap(),
    ]);

    let error = NotificationReaderCompletion::new(reader.clone(), withdrawal.clone())
        .complete(notification_id, recipients.clone())
        .await
        .unwrap_err();

    assert!(error.to_string().contains("first recipient update failed"));
    assert_eq!(*withdrawal.ids.lock().unwrap(), vec![notification_id]);
    let attempts = reader.attempts.lock().unwrap();
    assert_eq!(attempts.len(), recipients.len());
    assert_eq!(
        attempts
            .iter()
            .map(|(user, _)| user.clone())
            .collect::<HashSet<_>>(),
        recipients
    );
    assert!(attempts.iter().all(|(_, id)| *id == notification_id));
}
