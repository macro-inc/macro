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
/// none, and records what each read asked for.
#[derive(Default)]
struct Reader {
    messages: HashMap<Uuid, Vec<RecentInboxMessage>>,
    reads: Mutex<Vec<RecentRead>>,
}

impl Reader {
    fn limits(&self) -> Vec<u16> {
        self.reads
            .lock()
            .unwrap()
            .iter()
            .map(|read| read.limit)
            .collect()
    }
}

impl RecentInboxReader for Reader {
    async fn recent(
        &self,
        mailbox: &RecentInboxMailbox,
        read: RecentRead,
    ) -> Result<Vec<RecentInboxMessage>, RecentInboxReadError> {
        self.reads.lock().unwrap().push(read);
        self.messages
            .get(&mailbox.key.link_id)
            .cloned()
            .ok_or(EmailApiError::AuthRequired.into())
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
        labels: vec!["INBOX".to_owned()],
        body: None,
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
    let revoked_id = revoked.key.link_id;
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

    let messages = service
        .read(&actor(), 2, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();

    assert_eq!(
        messages
            .messages
            .iter()
            .map(|message| (message.inbox.as_str(), message.subject.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("owner@example.com", Some("Gmail newest")),
            ("work@example.com", Some("Outlook middle")),
        ]
    );
    assert_eq!(
        messages.unreadable_mailboxes,
        vec![UnreadableMailbox {
            link_id: revoked_id,
            reason: UnreadableMailboxReason::ProviderError
        }]
    );
    assert_eq!(service.reader.limits(), vec![2, 2, 2]);
    assert!(
        service
            .reader
            .reads
            .lock()
            .unwrap()
            .iter()
            .all(|read| read.since.is_none() && read.folder == RecentMailFolder::Inbox)
    );
}

#[tokio::test]
async fn limits_outside_one_to_a_hundred_are_clamped() {
    let inbox = mailbox("owner@example.com", UserProvider::Gmail);
    let reader = Reader {
        messages: HashMap::from([(inbox.key.link_id, Vec::new())]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![inbox])), reader);

    service
        .read(&actor(), 0, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();
    service
        .read(&actor(), 500, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();

    assert_eq!(service.reader.limits(), vec![1, MAX_RECENT_MESSAGES]);
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

    let messages = service
        .read(&actor(), 10, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();

    assert_eq!(messages.messages[0].subject, Some("é".repeat(200)));
    assert_eq!(messages.messages[0].snippet, Some("ü".repeat(300)));
    assert_eq!(messages.messages[1].subject.as_deref(), Some("Lunch?"));
}

#[tokio::test]
async fn a_user_without_inboxes_reads_nothing() {
    let service = RecentInboxService::new(Mailboxes(Ok(Vec::new())), Reader::default());

    let messages = service
        .read(&actor(), 10, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();

    assert!(messages.messages.is_empty());
}

#[tokio::test]
async fn an_inbox_lookup_failure_fails_the_read() {
    let service =
        RecentInboxService::new(Mailboxes(Err(MailboxError::Persistence)), Reader::default());

    let error = service
        .read(&actor(), 10, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap_err();

    assert!(matches!(error, MailboxError::Persistence));
}

#[tokio::test]
async fn a_longer_snippet_comes_from_the_body_only_when_asked_for() {
    let inbox = mailbox("owner@example.com", UserProvider::Gmail);
    let mut long = message("owner@example.com", "Order", "2026-10-27T12:00:00Z");
    long.snippet = Some("Your order shipped".to_owned());
    long.body = Some(format!(
        "Your order\n\n  shipped. {}",
        "Details ".repeat(100)
    ));
    let reader = Reader {
        messages: HashMap::from([(inbox.key.link_id, vec![long])]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![inbox])), reader);

    // Existing callers keep the provider's snippet.
    let messages = service
        .read(&actor(), 10, DEFAULT_SNIPPET_CHARS)
        .await
        .unwrap();
    assert_eq!(
        messages.messages[0].snippet.as_deref(),
        Some("Your order shipped")
    );
    assert_eq!(messages.messages[0].labels, ["INBOX"]);
    assert_eq!(messages.messages[0].body, None);

    let messages = service.read(&actor(), 10, 2_000).await.unwrap();
    let snippet = messages.messages[0].snippet.as_deref().unwrap();
    assert!(snippet.starts_with("Your order shipped. Details"));
    assert_eq!(snippet.chars().count(), usize::from(MAX_SNIPPET_CHARS));
    assert_eq!(messages.messages[0].body, None);
}

fn at(time: &str) -> DateTime<Utc> {
    time.parse().unwrap()
}

#[tokio::test]
async fn a_sent_window_merges_mailboxes_and_keeps_text_for_only_the_newest() {
    let gmail = mailbox("owner@example.com", UserProvider::Gmail);
    let outlook = mailbox("work@example.com", UserProvider::Outlook);
    let texted = |inbox: &str, subject: &str, received_at: &str| {
        let mut message = message(inbox, subject, received_at);
        message.snippet = Some(format!("{subject} text"));
        message.body = Some(format!("  {subject} text\nwith detail  "));
        message
    };
    let mut undated = texted("owner@example.com", "Undated", "2026-11-20T00:00:00Z");
    undated.received_at = None;
    let reader = Reader {
        messages: HashMap::from([
            (
                gmail.key.link_id,
                vec![
                    texted("owner@example.com", "Today", "2026-11-20T08:00:00Z"),
                    texted("owner@example.com", "Last week", "2026-11-13T08:00:00Z"),
                    // A provider answering past the window's start.
                    texted("owner@example.com", "Too old", "2026-11-09T23:59:59Z"),
                    undated,
                ],
            ),
            (
                outlook.key.link_id,
                vec![
                    texted("work@example.com", "Yesterday", "2026-11-19T08:00:00Z"),
                    texted("work@example.com", "Ten days ago", "2026-11-10T00:00:00Z"),
                ],
            ),
        ]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![gmail, outlook])), reader);
    let owner = actor();
    let read = |limit| {
        service.read_window(
            &owner,
            WindowRead {
                folder: RecentMailFolder::Sent,
                days: 10,
                limit,
                texts: 2,
                snippet_chars: MAX_SNIPPET_CHARS,
            },
            at("2026-11-20T00:00:00Z") + Duration::hours(12),
        )
    };
    let subjects = |messages: Vec<RecentInboxMessage>| {
        messages
            .into_iter()
            .map(|message| (message.subject, message.snippet))
            .collect::<Vec<_>>()
    };
    let text = |subject: &str| {
        (
            Some(subject.to_owned()),
            Some(format!("{subject} text with detail")),
        )
    };

    // Room for every message: only those of the window are kept.
    assert_eq!(
        subjects(read(10).await.unwrap().messages),
        vec![
            text("Today"),
            text("Yesterday"),
            (Some("Last week".to_owned()), None),
        ]
    );
    // The newest across both inboxes.
    assert_eq!(
        subjects(read(2).await.unwrap().messages),
        vec![text("Today"), text("Yesterday")]
    );
    let read = |limit| RecentRead {
        folder: RecentMailFolder::Sent,
        limit,
        since: Some(at("2026-11-10T12:00:00Z")),
    };
    assert_eq!(
        *service.reader.reads.lock().unwrap(),
        vec![read(10), read(10), read(2), read(2)]
    );

    // A limit of 0 reads one message, and a `texts` past the limit gives
    // it its snippet.
    let one = service
        .read_window(
            &owner,
            WindowRead {
                folder: RecentMailFolder::Sent,
                days: 10,
                limit: 0,
                texts: u16::MAX,
                snippet_chars: MAX_SNIPPET_CHARS,
            },
            at("2026-11-20T00:00:00Z") + Duration::hours(12),
        )
        .await
        .unwrap();
    assert_eq!(subjects(one.messages), vec![text("Today")]);
}

#[tokio::test]
async fn a_window_read_reaches_back_a_month_and_five_hundred_messages_at_most() {
    let inbox = mailbox("owner@example.com", UserProvider::Gmail);
    let reader = Reader {
        messages: HashMap::from([(inbox.key.link_id, Vec::new())]),
        ..Reader::default()
    };
    let service = RecentInboxService::new(Mailboxes(Ok(vec![inbox])), reader);
    let now = at("2026-11-20T00:00:00Z");
    let window = |days, limit| WindowRead {
        folder: RecentMailFolder::default(),
        days,
        limit,
        texts: 100,
        snippet_chars: DEFAULT_SNIPPET_CHARS,
    };

    service
        .read_window(&actor(), window(90, 900), now)
        .await
        .unwrap();
    service
        .read_window(&actor(), window(0, 0), now)
        .await
        .unwrap();

    assert_eq!(
        *service.reader.reads.lock().unwrap(),
        vec![
            RecentRead {
                folder: RecentMailFolder::Inbox,
                limit: MAX_WINDOW_MESSAGES,
                since: Some(now - Duration::days(i64::from(MAX_WINDOW_DAYS))),
            },
            RecentRead {
                folder: RecentMailFolder::Inbox,
                limit: 1,
                since: Some(now - Duration::days(1)),
            },
        ]
    );
}

#[tokio::test]
async fn unsupported_imap_window_is_reported_without_losing_healthy_mail() {
    struct PartialReader;
    impl RecentInboxReader for PartialReader {
        async fn recent(
            &self,
            mailbox: &RecentInboxMailbox,
            read: RecentRead,
        ) -> Result<Vec<RecentInboxMessage>, RecentInboxReadError> {
            match mailbox.provider {
                UserProvider::Imap if read.since.is_some() => {
                    Err(RecentInboxReadError::Unsupported)
                }
                _ => Ok(vec![message(
                    "owner@example.com",
                    "Healthy",
                    "2026-11-20T10:00:00Z",
                )]),
            }
        }
    }
    let imap = mailbox("imap@example.com", UserProvider::Imap);
    let link_id = imap.key.link_id;
    let gmail = mailbox("owner@example.com", UserProvider::Gmail);
    let service = RecentInboxService::new(Mailboxes(Ok(vec![imap, gmail])), PartialReader);
    for folder in [RecentMailFolder::Inbox, RecentMailFolder::Sent] {
        let response = service
            .read_window(
                &actor(),
                WindowRead {
                    folder,
                    days: 30,
                    limit: 100,
                    texts: 100,
                    snippet_chars: 300,
                },
                at("2026-11-21T00:00:00Z"),
            )
            .await
            .unwrap();
        assert_eq!(response.messages.len(), 1);
        assert_eq!(response.messages[0].subject.as_deref(), Some("Healthy"));
        assert_eq!(
            response.unreadable_mailboxes,
            vec![UnreadableMailbox {
                link_id,
                reason: UnreadableMailboxReason::Unsupported
            }]
        );
    }
}

#[tokio::test]
async fn unsupported_context_is_not_a_provider_error_span() {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing::instrument::WithSubscriber as _;
    use tracing_subscriber::layer::SubscriberExt as _;
    struct Failures;
    impl RecentInboxReader for Failures {
        async fn recent(
            &self,
            mailbox: &RecentInboxMailbox,
            _: RecentRead,
        ) -> Result<Vec<RecentInboxMessage>, RecentInboxReadError> {
            match mailbox.provider {
                UserProvider::Imap => Err(RecentInboxReadError::Unsupported),
                _ => Err(EmailApiError::AuthRequired.into()),
            }
        }
    }
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    let service = RecentInboxService::new(
        Mailboxes(Ok(vec![
            mailbox("imap@example.com", UserProvider::Imap),
            mailbox("outlook@example.com", UserProvider::Outlook),
        ])),
        Failures,
    );
    let response = service
        .read(&actor(), 10, 300)
        .with_subscriber(subscriber)
        .await
        .unwrap();
    assert_eq!(response.unreadable_mailboxes.len(), 2);
    provider.force_flush().unwrap();
    let spans = exporter.get_finished_spans().unwrap();
    let unsupported = spans
        .iter()
        .find(|span| {
            span.attributes.iter().any(|a| {
                a.key.as_str() == "provider"
                    && a.value == opentelemetry::Value::String("Imap".into())
            })
        })
        .unwrap();
    assert!(!matches!(
        unsupported.status,
        opentelemetry::trace::Status::Error { .. }
    ));
    assert!(unsupported.events.is_empty());
    let failed = spans
        .iter()
        .find(|span| {
            span.attributes.iter().any(|a| {
                a.key.as_str() == "unreadable_reason"
                    && a.value == opentelemetry::Value::String("ProviderError".into())
            })
        })
        .unwrap();
    assert!(matches!(
        failed.status,
        opentelemetry::trace::Status::Error { .. }
    ));
    assert_eq!(failed.events.len(), 1);
    let aggregate = spans
        .iter()
        .find(|span| span.name == "email.recent_inbox")
        .unwrap();
    for key in ["failed_inbox_count", "unsupported_inbox_count"] {
        assert!(
            aggregate
                .attributes
                .iter()
                .any(|attribute| attribute.key.as_str() == key
                    && attribute.value == opentelemetry::Value::I64(1))
        );
    }
}
