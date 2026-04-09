use super::*;
use model::comms::{ChannelId, ParticipantRole};
use notification_hex::domain::models::{Notification, NotificationResult, SendNotificationRequest};
use notification_hex::domain::service::SendNotificationError;
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

struct MockNotificationIngress {
    recorded_requests: Mutex<Vec<serde_json::Value>>,
}

impl MockNotificationIngress {
    fn new() -> Self {
        Self {
            recorded_requests: Mutex::new(Vec::new()),
        }
    }

    fn recorded_requests(&self) -> Vec<serde_json::Value> {
        self.recorded_requests.lock().unwrap().clone()
    }
}

impl NotificationIngress for MockNotificationIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, rootcause::Report<SendNotificationError>> {
        let snapshot = serde_json::to_value(&req).unwrap();
        self.recorded_requests.lock().unwrap().push(snapshot);
        Ok(None)
    }
}

fn participant(user_id: MacroUserIdStr<'static>, channel_id: Uuid) -> ChannelParticipant {
    ChannelParticipant {
        user_id,
        channel_id: ChannelId(channel_id),
        role: ParticipantRole::Member,
        left_at: None,
        joined_at: chrono::Utc::now(),
    }
}

fn message(
    channel_id: Uuid,
    sender_id: MacroUserIdStr<'static>,
    thread_id: Option<Uuid>,
) -> Message {
    Message {
        id: Uuid::new_v4(),
        sender_id,
        content: "test".to_string(),
        thread_id,
        channel_id,
        created_at: chrono::Utc::now(),
        deleted_at: None,
        edited_at: None,
        updated_at: chrono::Utc::now(),
    }
}

fn private_metadata() -> CommonChannelMetadata {
    CommonChannelMetadata {
        channel_type: model_notifications::ChannelType::Private,
        channel_name: "group".to_string(),
    }
}

fn uid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(s).unwrap().into_owned()
}

fn get_type_name(req: &serde_json::Value) -> &str {
    req["req"]["notification"]["tag"].as_str().unwrap()
}

fn get_recipient_ids(req: &serde_json::Value) -> HashSet<String> {
    req["req"]["recipient_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

const MESSAGE_NOTIF_TYPES: &[&str] = &[
    "channel_message_send",
    "channel_message_reply",
    "channel_mention",
];

fn assert_single_message_notification_per_recipient(requests: &[serde_json::Value]) {
    let mut visited: HashMap<String, usize> = HashMap::new();

    for req in requests {
        let type_name = get_type_name(req);
        if !MESSAGE_NOTIF_TYPES.contains(&type_name) {
            continue;
        }
        for r in get_recipient_ids(req) {
            *visited.entry(r).or_default() += 1;
        }
    }

    let violations: Vec<_> = visited
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .collect();

    assert!(
        violations.is_empty(),
        "notifications sent to multiple recipients: {violations:?}"
    );
}

#[tokio::test]
async fn mentioned_users_get_mention_not_message_send() {
    let channel_id = Uuid::new_v4();
    let participants = vec![
        participant(uid("macro|sender@test.com"), channel_id),
        participant(uid("macro|alice@test.com"), channel_id),
        participant(uid("macro|bob@test.com"), channel_id),
    ];
    let msg = message(channel_id, uid("macro|sender@test.com"), None);
    let metadata = private_metadata();
    let user_mentions = vec!["macro|alice@test.com".to_string()];

    let ingress = MockNotificationIngress::new();
    ChannelMessageEvent {
        channel_id: &channel_id,
        message: &msg,
        channel_metadata: &metadata,
        channel_message_count: 1,
        user_mentions: &user_mentions,
        document_mentions: &[],
        participants: &participants,
        thread_participants: &[],
        thread_parent_sender_id: None,
        sender_profile_picture_url: None,
        existing_user_ids: HashSet::new(),
    }
    .send(&ingress)
    .await
    .unwrap();

    let requests = ingress.recorded_requests();
    assert_single_message_notification_per_recipient(&requests);

    let mention = requests
        .iter()
        .find(|r| get_type_name(r) == "channel_mention")
        .expect("should have mention notification");
    let mention_recipients = get_recipient_ids(mention);
    assert!(mention_recipients.contains("macro|alice@test.com"));

    let send = requests
        .iter()
        .find(|r| get_type_name(r) == "channel_message_send")
        .expect("should have message send notification");
    let send_recipients = get_recipient_ids(send);
    assert!(!send_recipients.contains("macro|alice@test.com"));
    assert!(send_recipients.contains("macro|bob@test.com"));
}

#[tokio::test]
async fn thread_reply_excludes_sender_and_mentions() {
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let participants = vec![
        participant(uid("macro|sender@test.com"), channel_id),
        participant(uid("macro|alice@test.com"), channel_id),
        participant(uid("macro|bob@test.com"), channel_id),
        participant(uid("macro|charlie@test.com"), channel_id),
    ];
    let msg = message(channel_id, uid("macro|sender@test.com"), Some(thread_id));
    let metadata = private_metadata();
    let user_mentions = vec!["macro|alice@test.com".to_string()];
    let thread_participants = vec![
        MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
        MacroUserIdStr::parse_from_str("macro|charlie@test.com").unwrap(),
    ];

    let ingress = MockNotificationIngress::new();
    ChannelMessageEvent {
        channel_id: &channel_id,
        message: &msg,
        channel_metadata: &metadata,
        channel_message_count: 5,
        user_mentions: &user_mentions,
        document_mentions: &[],
        participants: &participants,
        thread_participants: &thread_participants,
        thread_parent_sender_id: Some(uid("macro|thread_parent_sender@test.com")),
        sender_profile_picture_url: None,
        existing_user_ids: HashSet::new(),
    }
    .send(&ingress)
    .await
    .unwrap();

    let requests = ingress.recorded_requests();
    assert_single_message_notification_per_recipient(&requests);

    let reply = requests
        .iter()
        .find(|r| get_type_name(r) == "channel_message_reply")
        .expect("should have reply notification");
    let recipients = get_recipient_ids(reply);
    assert!(!recipients.contains("macro|sender@test.com"));
    assert!(!recipients.contains("macro|alice@test.com"));
    assert!(recipients.contains("macro|bob@test.com"));
    assert!(recipients.contains("macro|charlie@test.com"));
}

fn has_email(req: &serde_json::Value) -> bool {
    !req["build_email"].is_null()
}

#[tokio::test]
async fn first_message_sends_email_invite_to_non_existing_users() {
    let channel_id = Uuid::new_v4();
    let participants = vec![
        participant(uid("macro|sender@test.com"), channel_id),
        participant(uid("macro|existing@test.com"), channel_id),
        participant(uid("macro|newuser@test.com"), channel_id),
    ];
    let msg = message(channel_id, uid("macro|sender@test.com"), None);
    let metadata = private_metadata();

    // Only existing@test.com is a known user
    let existing_user_ids: HashSet<String> = HashSet::from(["macro|existing@test.com".to_string()]);

    let ingress = MockNotificationIngress::new();
    ChannelMessageEvent {
        channel_id: &channel_id,
        message: &msg,
        channel_metadata: &metadata,
        channel_message_count: 0,
        user_mentions: &[],
        document_mentions: &[],
        participants: &participants,
        thread_participants: &[],
        thread_parent_sender_id: None,
        sender_profile_picture_url: None,
        existing_user_ids,
    }
    .send(&ingress)
    .await
    .unwrap();

    let requests = ingress.recorded_requests();

    // Should produce exactly two channel_invite notifications
    let invites: Vec<_> = requests
        .iter()
        .filter(|r| get_type_name(r) == "channel_invite")
        .collect();
    assert_eq!(invites.len(), 2, "expected two invite notifications");

    // The invite to the existing user should NOT have email
    let existing_invite = invites
        .iter()
        .find(|r| get_recipient_ids(r).contains("macro|existing@test.com"))
        .expect("should have invite for existing user");
    assert!(
        !has_email(existing_invite),
        "existing user invite should not have email"
    );

    // The invite to the non-existing user SHOULD have email
    let new_user_invite = invites
        .iter()
        .find(|r| get_recipient_ids(r).contains("macro|newuser@test.com"))
        .expect("should have invite for non-existing user");
    assert!(
        has_email(new_user_invite),
        "non-existing user invite should have email"
    );
}
