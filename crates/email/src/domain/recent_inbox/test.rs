use super::*;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

const ACTOR: &str = "macro|owner@example.com";

struct Mailboxes(Result<Vec<RecentInboxMailbox>, MailboxError>);

impl RecentInboxMailboxes for Mailboxes {
    async fn readable_owned_inboxes(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<RecentInboxMailbox>, MailboxError> {
        assert_eq!(actor.as_ref(), ACTOR);
        match &self.0 {
            Ok(inboxes) => Ok(inboxes.clone()),
            Err(_) => Err(MailboxError::Persistence),
        }
    }
}

/// Answers each inbox with its scripted messages, or fails it when it has
/// none, and records the limit each read asked for.
#[derive(Default)]
struct Reader {
    messages: HashMap<Uuid, Vec<RecentInboxMessage>>,
    limits: Mutex<Vec<u16>>,
}

impl RecentInboxReader for Reader {
    async fn recent(
        &self,
        mailbox: &RecentInboxMailbox,
        limit: u16,
    ) -> Result<Vec<RecentInboxMessage>, EmailApiError> {
        self.limits.lock().unwrap().push(limit);
        self.messages
            .get(&mailbox.key.link_id)
            .cloned()
            .ok_or(EmailApiError::AuthRequired)
    }
}

fn mailbox(email_address: &str, provider: UserProvider) -> RecentInboxMailbox {
    RecentInboxMailbox {
        key: MailboxKey {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        },
        provider,
        email_address: email_address.to_owned(),
    }
}

fn message(inbox: &str, subject: &str, received_at: &str) -> RecentInboxMessage {
    RecentInboxMessage {
        inbox: inbox.to_owned(),
        from: None,
        to: vec![inbox.to_owned()],
        cc: Vec::new(),
        subject: Some(subject.to_owned()),
        snippet: None,
        received_at: Some(received_at.parse::<DateTime<Utc>>().unwrap()),
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(ACTOR.to_owned()).unwrap()
}

#[tokio::test]
async fn merges_inboxes_newest_first_and_skips_one_that_fails() {
    let gmail = mailbox("owner@example.com", UserProvider::Gmail);
    let outlook = mailbox("work@example.com", UserProvider::Outlook);
    let revoked = mailbox("old@example.com", UserProvider::Gmail);
    let reader = Reader {
        messages: HashMap::from([
            (
                gmail.key.link_id,
                vec![
                    message("owner@example.com", "Gmail newest", "2026-10-27T12:00:00Z"),
                    message("owner@example.com", "Gmail oldest", "2026-10-25T12:00:00Z"),
                ],
            ),
            (
                outlook.key.link_id,
                vec![message(
                    "work@example.com",
                    "Outlook middle",
                    "2026-10-26T12:00:00Z",
                )],
            ),
        ]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![gmail, revoked, outlook])), reader);

    let messages = service.read(&actor(), 2).await.unwrap();

    assert_eq!(
        messages
            .iter()
            .map(|message| (message.inbox.as_str(), message.subject.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("owner@example.com", Some("Gmail newest")),
            ("work@example.com", Some("Outlook middle")),
        ]
    );
    assert_eq!(*service.reader.limits.lock().unwrap(), vec![2, 2, 2]);
}

#[tokio::test]
async fn limits_outside_one_to_fifty_are_clamped() {
    let inbox = mailbox("owner@example.com", UserProvider::Gmail);
    let reader = Reader {
        messages: HashMap::from([(inbox.key.link_id, Vec::new())]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![inbox])), reader);

    service.read(&actor(), 0).await.unwrap();
    service.read(&actor(), 500).await.unwrap();

    assert_eq!(*service.reader.limits.lock().unwrap(), vec![1, 50]);
}

#[tokio::test]
async fn long_subjects_and_snippets_are_cut_at_a_character_boundary() {
    let inbox = mailbox("owner@example.com", UserProvider::Outlook);
    let mut long = message(
        "owner@example.com",
        &"é".repeat(250),
        "2026-10-27T12:00:00Z",
    );
    long.snippet = Some("ü".repeat(400));
    let short = message("owner@example.com", "Lunch?", "2026-10-26T12:00:00Z");
    let reader = Reader {
        messages: HashMap::from([(inbox.key.link_id, vec![long, short])]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![inbox])), reader);

    let messages = service.read(&actor(), 10).await.unwrap();

    assert_eq!(messages[0].subject, Some("é".repeat(200)));
    assert_eq!(messages[0].snippet, Some("ü".repeat(300)));
    assert_eq!(messages[1].subject.as_deref(), Some("Lunch?"));
}

#[tokio::test]
async fn a_user_without_inboxes_reads_nothing() {
    let service = RecentInboxService::new(Mailboxes(Ok(Vec::new())), Reader::default());

    let messages = service.read(&actor(), 10).await.unwrap();

    assert!(messages.is_empty());
}

#[tokio::test]
async fn an_inbox_lookup_failure_fails_the_read() {
    let service =
        RecentInboxService::new(Mailboxes(Err(MailboxError::Persistence)), Reader::default());

    let error = service.read(&actor(), 10).await.unwrap_err();

    assert!(matches!(error, MailboxError::Persistence));
}
