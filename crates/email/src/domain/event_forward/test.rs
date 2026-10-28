use super::*;
use crate::domain::models::{Link, ResolvedSendingInbox, UserProvider};
use calendar_events::domain::ics::{CalendarEventForward, CalendarEventIcs};
use rootcause::Report;
use std::sync::Mutex;

const EVENT_ICS: &str = "BEGIN:VCALENDAR\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n";

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|guest@example.com").unwrap()
}

fn link(address: &str) -> Link {
    Link {
        id: Uuid::from_u128(0x11),
        macro_id: actor(),
        fusionauth_user_id: String::new(),
        email_address: EmailStr::try_from(address.to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn contact(email: &str) -> ContactInfo {
    ContactInfo {
        email: email.to_owned(),
        name: None,
        photo_url: None,
    }
}

/// One fake behind every port, recording what the use case asked of each.
#[derive(Default)]
struct Fake {
    /// What the calendar answers; `None` is an event the requester cannot forward.
    forward: Option<CalendarEventForward>,
    /// Inboxes the requester can send from.
    inboxes: Vec<&'static str>,
    resolved_addresses: Mutex<Vec<Option<String>>>,
    sent: Mutex<Vec<(Uuid, CreateDraftInput, Vec<SourcedAttachment>)>>,
}

impl CalendarEventForwardSource for Fake {
    async fn event_forward(
        &self,
        requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<CalendarEventForward>, Report> {
        assert_eq!(requester_id, "macro|guest@example.com");
        Ok(self.forward.clone())
    }
}

impl SendingInboxResolver for Fake {
    async fn resolve_sending_inbox(
        &self,
        _macro_id: MacroUserIdStr<'_>,
        request: SendingInboxRequest<'_>,
    ) -> Result<ResolvedSendingInbox, EmailErr> {
        let requested = request.requested_address.map(str::to_owned);
        self.resolved_addresses
            .lock()
            .unwrap()
            .push(requested.clone());
        let requested = requested.unwrap_or_default();
        if !self.inboxes.contains(&requested.as_str()) {
            return Err(EmailErr::UnknownSendingInbox {
                requested,
                available: self.inboxes.iter().map(|inbox| inbox.to_string()).collect(),
            });
        }
        Ok(ResolvedSendingInbox {
            link: link(&requested),
            accessible_inboxes: self.inboxes.iter().map(|inbox| link(inbox)).collect(),
        })
    }
}

impl EmailFileSendService for Fake {
    async fn send_message_with_files(
        &self,
        link: &Link,
        _accessible_inboxes: &[Link],
        input: CreateDraftInput,
        files: Vec<SourcedAttachment>,
    ) -> Result<CreatedDraft, EmailErr> {
        let created = CreatedDraft {
            draft_generation: 0,
            db_id: Uuid::from_u128(0xd1),
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: None,
            thread_db_id: Uuid::from_u128(0x7a),
            link_id: link.id,
            subject: input.subject.clone(),
            to: input.to.clone(),
            cc: Vec::new(),
            bcc: Vec::new(),
            body_text: input.body_text.clone(),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: None,
        };
        self.sent.lock().unwrap().push((link.id, input, files));
        Ok(created)
    }
}

fn guest_copy(title: &str) -> Fake {
    Fake {
        forward: Some(CalendarEventForward {
            ics: CalendarEventIcs {
                title: title.to_owned(),
                document: EVENT_ICS.to_owned(),
            },
            inbox: "guest@example.com".to_owned(),
        }),
        inboxes: vec!["work@example.com", "guest@example.com"],
        ..Fake::default()
    }
}

async fn forward(
    fake: &Fake,
    request: EventForwardRequest,
) -> Result<CreatedDraft, EventForwardError> {
    forward_event(fake, fake, fake, actor(), Uuid::from_u128(0xe1), request).await
}

#[tokio::test]
async fn sends_the_event_file_from_the_inbox_holding_the_copy() {
    let fake = guest_copy("Office tour");
    let sent = forward(
        &fake,
        EventForwardRequest {
            to: vec![contact("friend@example.org")],
            body_text: Some("Office tour\nWhen: Friday".to_owned()),
        },
    )
    .await
    .unwrap();

    assert_eq!(sent.db_id, Uuid::from_u128(0xd1));
    assert_eq!(
        *fake.resolved_addresses.lock().unwrap(),
        [Some("guest@example.com".to_owned())],
        "the copy's own inbox sends, not the requester's default one"
    );
    let sent = fake.sent.lock().unwrap();
    let (_, input, files) = &sent[0];
    assert_eq!(input.subject, "Office tour");
    assert_eq!(input.to.len(), 1);
    assert_eq!(input.to[0].email, "friend@example.org");
    assert!(input.cc.is_empty() && input.bcc.is_empty());
    assert_eq!(input.replying_to_id, None);
    assert_eq!(
        input.body_text.as_deref(),
        Some("Office tour\nWhen: Friday")
    );
    let html = URL_SAFE_NO_PAD
        .decode(input.body_html.as_deref().unwrap())
        .unwrap();
    assert_eq!(
        String::from_utf8(html).unwrap(),
        "<div>Office tour<br>When: Friday</div>"
    );
    assert_eq!(
        input.actor.as_ref().map(ToString::to_string).as_deref(),
        Some("macro|guest@example.com")
    );
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_name, "Office tour.ics");
    assert_eq!(files[0].content_type, "text/calendar");
    assert_eq!(files[0].bytes, EVENT_ICS.as_bytes());
}

#[tokio::test]
async fn a_missing_body_names_the_event_and_says_the_guest_list_is_unchanged() {
    let fake = guest_copy("  ");
    forward(
        &fake,
        EventForwardRequest {
            to: vec![contact("friend@example.org")],
            body_text: Some("   ".to_owned()),
        },
    )
    .await
    .unwrap();

    let sent = fake.sent.lock().unwrap();
    let (_, input, files) = &sent[0];
    assert_eq!(input.subject, "Untitled event");
    let body = input.body_text.as_deref().unwrap();
    assert!(body.starts_with("Untitled event\n\n"), "{body}");
    assert!(
        body.contains("You won't be on the organizer's guest list."),
        "{body}"
    );
    assert_eq!(files[0].file_name, "Untitled event.ics");
}

#[tokio::test]
async fn markup_in_the_body_is_escaped_and_the_title_cannot_name_a_path() {
    let fake = guest_copy("Q3/Q4 <review>");
    forward(
        &fake,
        EventForwardRequest {
            to: vec![contact("friend@example.org")],
            body_text: Some("<b>&</b>".to_owned()),
        },
    )
    .await
    .unwrap();

    let sent = fake.sent.lock().unwrap();
    let (_, input, files) = &sent[0];
    let html = URL_SAFE_NO_PAD
        .decode(input.body_html.as_deref().unwrap())
        .unwrap();
    assert_eq!(
        String::from_utf8(html).unwrap(),
        "<div>&lt;b&gt;&amp;&lt;/b&gt;</div>"
    );
    assert_eq!(files[0].file_name, "Q3-Q4 <review>.ics");
}

#[tokio::test]
async fn recipients_are_trimmed_and_deduplicated_in_order() {
    let fake = guest_copy("Office tour");
    forward(
        &fake,
        EventForwardRequest {
            to: vec![
                contact(" friend@example.org "),
                contact("other@example.org"),
                contact("Friend@Example.org"),
            ],
            body_text: None,
        },
    )
    .await
    .unwrap();

    let sent = fake.sent.lock().unwrap();
    let emails: Vec<_> = sent[0].1.to.iter().map(|to| to.email.as_str()).collect();
    assert_eq!(emails, ["friend@example.org", "other@example.org"]);
}

#[tokio::test]
async fn invalid_recipients_are_refused_before_anything_is_read() {
    for to in [
        vec![],
        vec![contact("not an address")],
        (0..=MAX_FORWARD_RECIPIENTS)
            .map(|index| contact(&format!("person{index}@example.org")))
            .collect(),
    ] {
        let fake = guest_copy("Office tour");
        let error = forward(
            &fake,
            EventForwardRequest {
                to,
                body_text: None,
            },
        )
        .await
        .unwrap_err();
        assert!(
            matches!(error, EventForwardError::InvalidRecipients(_)),
            "{error:?}"
        );
        assert!(fake.resolved_addresses.lock().unwrap().is_empty());
        assert!(fake.sent.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn an_event_the_requester_cannot_forward_is_not_found() {
    let fake = Fake {
        inboxes: vec!["guest@example.com"],
        ..Fake::default()
    };
    let error = forward(
        &fake,
        EventForwardRequest {
            to: vec![contact("friend@example.org")],
            body_text: None,
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(error, EventForwardError::NotFound), "{error:?}");
    assert!(fake.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_inbox_that_cannot_send_is_refused_rather_than_replaced() {
    let fake = Fake {
        inboxes: vec!["work@example.com"],
        ..guest_copy("Office tour")
    };
    let error = forward(
        &fake,
        EventForwardRequest {
            to: vec![contact("friend@example.org")],
            body_text: None,
        },
    )
    .await
    .unwrap_err();
    assert!(
        matches!(error, EventForwardError::InboxUnavailable),
        "{error:?}"
    );
    assert!(fake.sent.lock().unwrap().is_empty());
}
