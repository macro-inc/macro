use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use bot_id::BotId;
use chrono::{DateTime, TimeDelta, Utc};
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::PingAgent;
use notification::domain::models::{Notification, NotificationResult, SendNotificationRequest};
use notification::domain::service::{NotificationIngress, SendNotificationError};
use rootcause::Report;
use serde::Serialize;
use uuid::Uuid;

use super::{
    AGENT_NOTIFICATIONS_FLAG, AgentProfiles, AllowanceExceeded, ChannelMessages, DEDUPE_WINDOW,
    FeedVisibility, LinkAccess, LocatedMessage, MAX_RECIPIENTS, PingDraft, PingError, PingOutcome,
    PingSender, Pings, SendAllowance, SkipReason, SkippedRecipient,
};

mod delivered;

const CHANNEL: Uuid = Uuid::from_u128(0xC0);
const MESSAGE: Uuid = Uuid::from_u128(0x101);
const ROOT: Uuid = Uuid::from_u128(0x7A);

/// Records every request as JSON, the way the SQS ingress would serialize it.
#[derive(Default)]
struct RecordingIngress {
    sent: Mutex<Vec<serde_json::Value>>,
}

impl NotificationIngress for RecordingIngress {
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
            .push(serde_json::to_value(&req).unwrap());
        Ok(None)
    }
}

/// What the flag provider says about every sender.
enum SenderFlag {
    On,
    Off,
    Unreadable,
}

impl FeatureFlags for SenderFlag {
    async fn load(&self, _user: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let enabled = match self {
            Self::On => true,
            Self::Off => false,
            Self::Unreadable => return Err(rootcause::report!("flag provider timed out")),
        };
        Ok(FlagSnapshot::new([(
            AGENT_NOTIFICATIONS_FLAG.to_string(),
            FlagValue::Boolean(enabled),
        )]))
    }
}

/// Grants view access to exactly the listed (user, entity id) pairs.
struct GrantedAccess(HashSet<(&'static str, &'static str)>);

impl LinkAccess for GrantedAccess {
    async fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<bool, Report> {
        Ok(self.0.iter().any(|(granted_user, granted_entity)| {
            user.as_ref() == *granted_user && entity.entity_id == *granted_entity
        }))
    }
}

/// An inbox that lists everything except `session-unlisted`, for everyone,
/// and the (user, entity id) pairs it leaves out.
#[derive(Default)]
struct InboxLeavesOut(HashSet<(&'static str, &'static str)>);

impl FeedVisibility for InboxLeavesOut {
    async fn admits(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> Result<bool, Report> {
        Ok(link.entity_id != "session-unlisted"
            && !self
                .0
                .iter()
                .any(|(user, entity)| viewer.as_ref() == *user && link.entity_id == *entity))
    }
}

/// Knows one reply in a channel thread, readable by the channel's members.
struct OneMessage;

impl ChannelMessages for OneMessage {
    async fn locate(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: &str,
    ) -> Result<Option<LocatedMessage>, Report> {
        let member =
            ["macro|sender@macro.com", "macro|teammate@macro.com"].contains(&user.as_ref());
        Ok(
            (member && message_id == MESSAGE.to_string()).then_some(LocatedMessage {
                channel_id: CHANNEL,
                message_id: MESSAGE,
                thread_id: Some(ROOT),
            }),
        )
    }
}

/// An allowance of `limit` notifications that never refills, recording what
/// each sender took, and a cap of `received_limit` on what each recipient
/// gets from others.
struct FixedAllowance {
    limit: u64,
    taken: Mutex<Vec<(String, u64)>>,
    received_limit: u64,
    received: Mutex<HashMap<String, u64>>,
}

impl FixedAllowance {
    fn of(limit: u64) -> Self {
        Self {
            limit,
            taken: Mutex::default(),
            received_limit: 60,
            received: Mutex::default(),
        }
    }

    fn received_by(&self, recipient: &str) -> u64 {
        self.received
            .lock()
            .unwrap()
            .get(recipient)
            .copied()
            .unwrap_or(0)
    }
}

impl SendAllowance for FixedAllowance {
    async fn take(
        &self,
        sender: &MacroUserIdStr<'_>,
        notifications: u64,
    ) -> Result<Result<(), AllowanceExceeded>, Report> {
        let mut taken = self.taken.lock().unwrap();
        let used: u64 = taken.iter().map(|(_, count)| count).sum();
        if used + notifications > self.limit {
            return Ok(Err(AllowanceExceeded {
                limit: self.limit,
                retry_after: Duration::from_secs(25 * 60 + 1),
            }));
        }
        taken.push((sender.as_ref().to_string(), notifications));
        Ok(Ok(()))
    }

    async fn take_received(&self, recipient: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        let mut received = self.received.lock().unwrap();
        let count = received.entry(recipient.as_ref().to_string()).or_default();
        if *count >= self.received_limit {
            return Ok(false);
        }
        *count += 1;
        Ok(true)
    }

    async fn give_back_received(&self, recipient: &MacroUserIdStr<'_>) -> Result<(), Report> {
        let mut received = self.received.lock().unwrap();
        let count = received
            .get_mut(recipient.as_ref())
            .expect("a count to give back");
        *count -= 1;
        Ok(())
    }
}

/// Knows one agent, the one the sending code runs as.
struct OneAgent;

impl AgentProfiles for OneAgent {
    async fn profile(&self, agent_id: BotId) -> Result<Option<PingAgent>, Report> {
        Ok(
            (agent_id.as_uuid() == Uuid::from_u128(0xB07)).then(|| PingAgent {
                id: agent_id.as_uuid(),
                name: "Deploy bot".to_string(),
                avatar_url: None,
            }),
        )
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

type Notifications = Pings<
    SenderFlag,
    GrantedAccess,
    InboxLeavesOut,
    OneMessage,
    OneAgent,
    FixedAllowance,
    RecordingIngress,
>;

fn service(grants: &[(&'static str, &'static str)]) -> Notifications {
    Pings {
        flags: SenderFlag::On,
        access: GrantedAccess(grants.iter().copied().collect()),
        feeds: InboxLeavesOut::default(),
        messages: OneMessage,
        agents: OneAgent,
        allowance: FixedAllowance::of(1000),
        ingress: RecordingIngress::default(),
    }
}

/// `minutes` after an instant that starts a dedupe window.
fn at(minutes: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(DEDUPE_WINDOW.num_seconds() * 1_000_000, 0).unwrap()
        + TimeDelta::minutes(minutes)
}

fn sender() -> PingSender {
    PingSender {
        user: user("macro|sender@macro.com"),
        opaque_id: "sender-opaque-id".to_string(),
        agent_id: None,
    }
}

fn draft(recipients: &[&str], link: Entity<'static>) -> PingDraft {
    PingDraft {
        recipients: recipients.iter().map(|id| user(id)).collect(),
        title: "Look at this".to_string(),
        body: None,
        link,
    }
}

fn document() -> Entity<'static> {
    EntityType::Document.with_entity_string("doc-1".to_string())
}

fn notified(recipients: &[&str]) -> PingOutcome {
    PingOutcome {
        notified: recipients.iter().map(|id| user(id)).collect(),
        skipped: Vec::new(),
    }
}

fn no_access(recipient: &str) -> SkippedRecipient {
    SkippedRecipient {
        user_id: user(recipient),
        reason: SkipReason::NoAccess,
    }
}

/// The recipients of a recorded request, sorted.
fn recipients_of(request: &serde_json::Value) -> Vec<String> {
    let mut recipients: Vec<String> =
        serde_json::from_value(request["req"]["recipient_ids"].clone()).unwrap();
    recipients.sort();
    recipients
}

#[tokio::test]
async fn notifies_a_recipient_who_can_see_the_link_from_the_sender() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);

    let outcome = notifications
        .send(
            PingSender {
                user: user("macro|sender@macro.com"),
                opaque_id: "sender-opaque-id".to_string(),
                agent_id: Some(BotId::new_from_uuid(Uuid::from_u128(0xB07))),
            },
            PingDraft {
                recipients: vec![user("macro|teammate@macro.com")],
                title: "  Deploy finished ".to_string(),
                body: Some("All 3 services are live.".to_string()),
                link: document(),
            },
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(outcome, notified(&["macro|teammate@macro.com"]));
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    let request = &sent[0];
    assert_eq!(
        request["req"]["notification_entity"],
        serde_json::json!({ "entity_type": "document", "entity_id": "doc-1" })
    );
    assert_eq!(
        request["req"]["notification"],
        serde_json::json!({
            "tag": "ping",
            "content": {
                "title": "Deploy finished",
                "body": "All 3 services are live.",
                "agent": {
                    "id": "00000000-0000-0000-0000-000000000b07",
                    "name": "Deploy bot",
                },
            },
        })
    );
    assert_eq!(request["req"]["sender_id"], "macro|sender@macro.com");
    assert_eq!(recipients_of(request), ["macro|teammate@macro.com"]);
    assert_eq!(
        request["build_apns"]["notif"]["aps"]["alert"],
        serde_json::json!({ "title": "Deploy finished", "body": "All 3 services are live." })
    );
    assert_eq!(request["send_conn_gateway"], true);
}

#[tokio::test]
async fn a_note_to_oneself_has_no_sender_so_the_ingress_keeps_it() {
    let notifications = service(&[("macro|sender@macro.com", "session-1")]);

    let outcome = notifications
        .send(
            sender(),
            PingDraft {
                recipients: Vec::new(),
                title: "3 new leads".to_string(),
                body: Some("   ".to_string()),
                link: EntityType::AgentSession.with_entity_string("session-1".to_string()),
            },
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(outcome, notified(&["macro|sender@macro.com"]));
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent[0]["req"]["sender_id"], serde_json::Value::Null);
    assert_eq!(recipients_of(&sent[0]), ["macro|sender@macro.com"]);
    assert_eq!(
        sent[0]["req"]["notification"],
        serde_json::json!({ "tag": "ping", "content": { "title": "3 new leads" } })
    );
}

#[tokio::test]
async fn skips_and_reports_recipients_who_cannot_see_the_link() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
        ("macro|reviewer@macro.com", "doc-1"),
    ]);

    let outcome = notifications
        .send(
            sender(),
            draft(
                &[
                    "macro|teammate@macro.com",
                    "macro|outsider@macro.com",
                    "macro|reviewer@macro.com",
                    // Named twice, told once.
                    "macro|teammate@macro.com",
                ],
                document(),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: vec![
                user("macro|teammate@macro.com"),
                user("macro|reviewer@macro.com"),
            ],
            skipped: vec![no_access("macro|outsider@macro.com")],
        }
    );
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        recipients_of(&sent[0]),
        ["macro|reviewer@macro.com", "macro|teammate@macro.com"]
    );
}

#[tokio::test]
async fn sends_nothing_when_no_recipient_can_see_the_link() {
    let notifications = service(&[("macro|sender@macro.com", "doc-1")]);

    let outcome = notifications
        .send(
            sender(),
            draft(&["macro|outsider@macro.com"], document()),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: Vec::new(),
            skipped: vec![no_access("macro|outsider@macro.com")],
        }
    );
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_sender_among_the_recipients_gets_a_copy_with_no_sender() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);

    let outcome = notifications
        .send(
            sender(),
            draft(
                &["macro|sender@macro.com", "macro|teammate@macro.com"],
                document(),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        notified(&["macro|sender@macro.com", "macro|teammate@macro.com"])
    );
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0]["req"]["sender_id"], "macro|sender@macro.com");
    assert_eq!(recipients_of(&sent[0]), ["macro|teammate@macro.com"]);
    assert_eq!(sent[1]["req"]["sender_id"], serde_json::Value::Null);
    assert_eq!(recipients_of(&sent[1]), ["macro|sender@macro.com"]);
}

#[tokio::test]
async fn a_channel_message_is_filed_under_its_channel_and_names_the_message() {
    let channel = CHANNEL.to_string();
    // Leaked so the grants can borrow it for the test's whole life.
    let channel: &'static str = channel.leak();
    let notifications = service(&[("macro|teammate@macro.com", channel)]);

    let outcome = notifications
        .send(
            sender(),
            draft(
                &["macro|teammate@macro.com", "macro|outsider@macro.com"],
                EntityType::ChannelMessage.with_entity_string(MESSAGE.to_string()),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: vec![user("macro|teammate@macro.com")],
            skipped: vec![no_access("macro|outsider@macro.com")],
        }
    );
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(
        sent[0]["req"]["notification_entity"],
        serde_json::json!({ "entity_type": "channel", "entity_id": channel })
    );
    assert_eq!(
        sent[0]["req"]["notification"]["content"]["message"],
        serde_json::json!({
            "messageId": MESSAGE.to_string(),
            "threadId": ROOT.to_string(),
        })
    );
    assert_eq!(
        sent[0]["build_apns"]["notif"]["navigation"],
        serde_json::json!({
            "type": "channel",
            "channelId": channel,
            "messageId": MESSAGE.to_string(),
            "threadId": ROOT.to_string(),
        })
    );
}

#[tokio::test]
async fn refuses_a_message_the_sender_cannot_read() {
    let notifications = service(&[]);

    let unknown = notifications
        .send(
            sender(),
            draft(
                &[],
                EntityType::ChannelMessage.with_entity_string(ROOT.to_string()),
            ),
            at(0),
        )
        .await
        .unwrap_err();
    assert!(matches!(unknown, PingError::LinkNotFound));

    let not_a_member = notifications
        .send(
            PingSender {
                user: user("macro|outsider@macro.com"),
                opaque_id: "outsider-opaque-id".to_string(),
                agent_id: None,
            },
            draft(
                &[],
                EntityType::ChannelMessage.with_entity_string(MESSAGE.to_string()),
            ),
            at(0),
        )
        .await
        .unwrap_err();
    assert!(matches!(not_a_member, PingError::LinkNotFound));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_a_link_the_sender_cannot_see() {
    let notifications = service(&[("macro|teammate@macro.com", "doc-1")]);

    let error = notifications
        .send(
            sender(),
            draft(&["macro|teammate@macro.com"], document()),
            at(0),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PingError::LinkNotFound));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn links_to_every_kind_of_entity_the_inbox_lists() {
    let notifications = service(&[("macro|sender@macro.com", "entity-1")]);

    for entity_type in [
        EntityType::Document,
        EntityType::Chat,
        EntityType::Channel,
        EntityType::Project,
        EntityType::Initiative,
        EntityType::EmailThread,
        EntityType::CalendarEvent,
        EntityType::CrmCompany,
        EntityType::CrmContact,
        EntityType::AgentSession,
    ] {
        let outcome = notifications
            .send(
                sender(),
                draft(&[], entity_type.with_entity_string("entity-1".to_string())),
                at(0),
            )
            .await
            .unwrap();
        assert_eq!(
            outcome,
            notified(&["macro|sender@macro.com"]),
            "{entity_type}"
        );
    }
}

#[tokio::test]
async fn refuses_blank_or_oversized_text_and_unlinkable_entities() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|sender@macro.com", "user-1"),
    ]);
    let text = |title: &str, body: Option<String>| PingDraft {
        recipients: Vec::new(),
        title: title.to_string(),
        body,
        link: document(),
    };

    let blank = notifications
        .send(sender(), text(" \n ", None), at(0))
        .await
        .unwrap_err();
    assert!(matches!(blank, PingError::EmptyTitle));

    let long_title = notifications
        .send(sender(), text(&"a".repeat(121), None), at(0))
        .await
        .unwrap_err();
    assert!(matches!(long_title, PingError::TitleTooLong));

    let long_body = notifications
        .send(sender(), text("Done", Some("é".repeat(1001))), at(0))
        .await
        .unwrap_err();
    assert!(matches!(long_body, PingError::BodyTooLong));

    let user_link = notifications
        .send(
            sender(),
            draft(
                &[],
                EntityType::User.with_entity_string("user-1".to_string()),
            ),
            at(0),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        user_link,
        PingError::UnlinkableEntity(EntityType::User)
    ));

    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_more_recipients_than_one_notification_can_name() {
    let notifications = service(&[("macro|sender@macro.com", "doc-1")]);
    let crowd = |count: usize| PingDraft {
        recipients: (0..count)
            .map(|n| user(&format!("macro|user{n}@macro.com")))
            .collect(),
        title: "Look at this".to_string(),
        body: None,
        link: document(),
    };

    let too_many = notifications
        .send(sender(), crowd(MAX_RECIPIENTS + 1), at(0))
        .await
        .unwrap_err();
    assert!(matches!(too_many, PingError::TooManyRecipients));

    // The cap itself is allowed; none of them can see the link, so all are
    // skipped and nothing is sent.
    let at_the_cap = notifications
        .send(sender(), crowd(MAX_RECIPIENTS), at(0))
        .await
        .unwrap();
    assert_eq!(at_the_cap.skipped.len(), MAX_RECIPIENTS);
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn counts_each_notified_recipient_against_the_senders_allowance() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
        ("macro|reviewer@macro.com", "doc-1"),
    ]);
    notifications.allowance = FixedAllowance::of(3);

    // Two can see the link and one cannot: two are counted.
    notifications
        .send(
            sender(),
            draft(
                &[
                    "macro|teammate@macro.com",
                    "macro|reviewer@macro.com",
                    "macro|outsider@macro.com",
                ],
                document(),
            ),
            at(0),
        )
        .await
        .unwrap();
    assert_eq!(
        *notifications.allowance.taken.lock().unwrap(),
        [("macro|sender@macro.com".to_string(), 2)]
    );

    // Two more do not fit in what is left, so nobody is notified.
    let error = notifications
        .send(
            sender(),
            PingDraft {
                title: "Something else".to_string(),
                ..draft(
                    &["macro|teammate@macro.com", "macro|reviewer@macro.com"],
                    document(),
                )
            },
            at(0),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        PingError::AllowanceExceeded(AllowanceExceeded { limit: 3, .. })
    ));
    assert_eq!(
        error.to_string(),
        "too many notifications: a sender can notify at most 3 recipients an hour; try again in 26 minutes"
    );
    assert_eq!(notifications.ingress.sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_repeat_within_the_window_has_the_same_id_so_it_is_delivered_once() {
    let notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
        ("macro|reviewer@macro.com", "doc-1"),
    ]);
    let send = async |recipients: &[&str], title: &str, minute: i64| {
        notifications
            .send(
                sender(),
                PingDraft {
                    title: title.to_string(),
                    ..draft(recipients, document())
                },
                at(minute),
            )
            .await
            .unwrap();
        let sent = notifications.ingress.sent.lock().unwrap();
        sent[sent.len() - 1]["uuid_to_write"].clone()
    };
    let both = ["macro|teammate@macro.com", "macro|reviewer@macro.com"];
    let reversed = ["macro|reviewer@macro.com", "macro|teammate@macro.com"];

    let first = send(&both, "Deploy finished", 0).await;
    // The same words to the same people, in any order, a few minutes later.
    assert_eq!(send(&reversed, "Deploy finished", 9).await, first);

    // Once the window has passed it is a new notification.
    assert_ne!(send(&both, "Deploy finished", 10).await, first);
    // So are other words, and other people.
    assert_ne!(send(&both, "Deploy failed", 0).await, first);
    assert_ne!(
        send(&["macro|teammate@macro.com"], "Deploy finished", 0).await,
        first
    );
}

#[tokio::test]
async fn refuses_a_sender_whose_flag_is_off_before_anything_else() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);
    notifications.flags = SenderFlag::Off;

    // Even a draft that would be refused for its text is refused for the flag.
    let error = notifications
        .send(
            sender(),
            PingDraft {
                title: " ".to_string(),
                ..draft(&["macro|teammate@macro.com"], document())
            },
            at(0),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PingError::NotEnabled));
    assert_eq!(
        error.to_string(),
        "agent notifications are not enabled for this account"
    );
    assert!(notifications.allowance.taken.lock().unwrap().is_empty());
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sends_nothing_when_the_senders_flag_cannot_be_read() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);
    notifications.flags = SenderFlag::Unreadable;

    let error = notifications
        .send(
            sender(),
            draft(&["macro|teammate@macro.com"], document()),
            at(0),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PingError::FlagsUnavailable(_)));
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refuses_links_the_inbox_never_lists() {
    let notifications = service(&[
        ("macro|sender@macro.com", "routine-1"),
        ("macro|sender@macro.com", "database-1"),
        ("macro|sender@macro.com", "form-1"),
    ]);

    for (entity_type, id) in [
        (EntityType::ScheduledAction, "routine-1"),
        (EntityType::Database, "database-1"),
        (EntityType::Form, "form-1"),
    ] {
        let error = notifications
            .send(
                sender(),
                draft(&[], entity_type.with_entity_string(id.to_string())),
                at(0),
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, PingError::NotShownInInbox(refused) if refused == entity_type),
            "{entity_type}: {error:?}"
        );
    }

    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

fn skipped(recipient: &str, reason: SkipReason) -> SkippedRecipient {
    SkippedRecipient {
        user_id: user(recipient),
        reason,
    }
}

#[tokio::test]
async fn skips_recipients_whose_inbox_would_not_list_the_link() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
        ("macro|link-holder@macro.com", "doc-1"),
    ]);
    // Can open it, through a link share the inbox does not read.
    notifications.feeds = InboxLeavesOut([("macro|link-holder@macro.com", "doc-1")].into());

    let outcome = notifications
        .send(
            sender(),
            draft(
                &["macro|teammate@macro.com", "macro|link-holder@macro.com"],
                document(),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: vec![user("macro|teammate@macro.com")],
            skipped: vec![skipped(
                "macro|link-holder@macro.com",
                SkipReason::NotListed
            )],
        }
    );
    let sent = notifications.ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(recipients_of(&sent[0]), ["macro|teammate@macro.com"]);
    assert_eq!(
        notifications
            .allowance
            .received_by("macro|link-holder@macro.com"),
        0
    );
}

#[tokio::test]
async fn skips_the_sender_too_when_their_own_inbox_would_not_list_it() {
    let notifications = service(&[("macro|sender@macro.com", "session-unlisted")]);

    let outcome = notifications
        .send(
            sender(),
            draft(
                &[],
                EntityType::AgentSession.with_entity_string("session-unlisted".to_string()),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome.skipped,
        [skipped("macro|sender@macro.com", SkipReason::NotListed)]
    );
    assert!(outcome.notified.is_empty());
    assert!(notifications.allowance.taken.lock().unwrap().is_empty());
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn skips_a_recipient_at_their_hourly_cap_and_still_notifies_the_rest() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
        ("macro|busy@macro.com", "doc-1"),
    ]);
    notifications.allowance.received_limit = 1;
    notifications
        .allowance
        .received
        .lock()
        .unwrap()
        .insert("macro|busy@macro.com".to_string(), 1);

    let outcome = notifications
        .send(
            sender(),
            draft(
                &[
                    "macro|teammate@macro.com",
                    "macro|busy@macro.com",
                    "macro|sender@macro.com",
                ],
                document(),
            ),
            at(0),
        )
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: vec![
                user("macro|teammate@macro.com"),
                user("macro|sender@macro.com")
            ],
            skipped: vec![skipped("macro|busy@macro.com", SkipReason::RecipientLimit)],
        }
    );
    assert_eq!(
        notifications
            .allowance
            .received_by("macro|teammate@macro.com"),
        1
    );
    // A ping to oneself never counts against one's own cap.
    assert_eq!(
        notifications
            .allowance
            .received_by("macro|sender@macro.com"),
        0
    );
}

#[tokio::test]
async fn gives_back_recipients_counts_when_the_sender_is_over_their_allowance() {
    let mut notifications = service(&[
        ("macro|sender@macro.com", "doc-1"),
        ("macro|teammate@macro.com", "doc-1"),
    ]);
    notifications.allowance.limit = 0;

    let error = notifications
        .send(
            sender(),
            draft(&["macro|teammate@macro.com"], document()),
            at(0),
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PingError::AllowanceExceeded(_)));
    assert_eq!(
        notifications
            .allowance
            .received_by("macro|teammate@macro.com"),
        0
    );
    assert!(notifications.ingress.sent.lock().unwrap().is_empty());
}
