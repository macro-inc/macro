use super::*;
use notification_hex::domain::{
    models::{Notification, SendNotificationRequest, request::NotificationResult},
    service::SendNotificationError,
};
use rootcause::Report;
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Mutex;

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
        self.sent
            .lock()
            .unwrap()
            .push(serde_json::to_value(req).unwrap());
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
                channel_id,
                invited_by_user_id: sender,
                registered_recipient_ids: HashSet::from([registered.clone()]),
                unregistered_recipient_ids: HashSet::from([unregistered.clone()]),
                sender_profile_picture_url: None,
                message_content: Some("Hey".to_string()),
                metadata: ChannelMetadata {
                    auto_join_team: false,
                    messaging_binding: Default::default(),
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
async fn channel_message_delivery_preserves_external_and_native_sender_identity() {
    use crate::domain::side_effects::NotificationSender;
    let user = MacroUserIdStr::try_from_email("sender@example.com").unwrap();
    for sender in [
        NotificationSender::User(user.clone()),
        NotificationSender::Bot {
            name: "Helper".into(),
        },
        NotificationSender::External {
            name: Some("Customer".into()),
        },
        NotificationSender::External { name: None },
    ] {
        let ingress = Arc::new(CapturingIngress::default());
        let notifications = NotificationChannelSender::new(ingress.clone());
        let message_id = Uuid::now_v7();
        let stable_id = matches!(sender, NotificationSender::External { .. }).then_some(message_id);
        for _ in 0..2 {
            notifications
                .send(ChannelNotificationEffect::ChannelMessage {
                    notification_id: stable_id,
                    channel_id: Uuid::from_u128(1),
                    message_id,
                    sender: sender.clone(),
                    message_content: "Hello".into(),
                    has_attachments: true,
                    metadata: ChannelMetadata {
                        auto_join_team: false,
                        messaging_binding: Default::default(),
                        channel_type: ChannelType::Private,
                        channel_name: "Customer chat".into(),
                    },
                    sender_profile_picture_url: None,
                    recipient_ids: HashSet::from([user.clone()]),
                })
                .await
                .unwrap();
        }
        let sent = ingress.sent.lock().unwrap();
        assert_eq!(sent.len(), 2);
        if let Some(id) = stable_id {
            assert_eq!(sent[0]["uuid_to_write"], id.to_string());
            assert_eq!(sent[0]["uuid_to_write"], sent[1]["uuid_to_write"]);
        } else {
            assert_ne!(sent[0]["uuid_to_write"], sent[1]["uuid_to_write"]);
        }
        let request = &sent[0];
        let content = &request["req"]["notification"]["content"];
        assert_eq!(request["req"]["sender_id"], json!(sender.as_user()));
        assert_eq!(content["sender"], json!(sender.as_user()));
        assert_eq!(content["senderDisplayName"], json!(sender.display_name()));
        assert_eq!(content["messageId"], message_id.to_string());
        if matches!(sender, NotificationSender::External { name: None }) {
            // Without a displayable sender the existing formatter omits push,
            // while persisted/connection-gateway notifications still retain it.
            assert!(request["build_apns"].is_null());
        } else {
            assert_eq!(
                request["build_apns"]["notif"]["aps"]["alert"]["body"], "Hello\n[attached items]",
                "sender: {sender:?}"
            );
        }
        assert_eq!(request["req"]["recipient_ids"], json!([user]));
        assert!(request["req"]["secondary_notification_entity"].is_null());
        assert_eq!(request["send_conn_gateway"], true);
        assert!(request["build_email"].is_null());
    }
}
