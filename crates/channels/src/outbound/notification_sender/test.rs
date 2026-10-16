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
