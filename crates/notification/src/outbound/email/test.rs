use super::*;
use macro_user_id::email::EmailStr;
use std::sync::Mutex;

const FROM: &str = "no-reply@macro.com";

#[test]
fn from_header_without_a_name_is_the_bare_address() {
    assert_eq!(from_header(FROM, None), FROM);
    assert_eq!(from_header(FROM, Some(" \r\n\t\"\\ ")), FROM);
}

#[test]
fn from_header_quotes_an_ascii_name_marked_as_via_macro() {
    assert_eq!(
        from_header(FROM, Some("Alice Example")),
        r#""Alice Example (via Macro)" <no-reply@macro.com>"#
    );
}

#[test]
fn from_header_cannot_be_broken_out_of_by_the_name() {
    assert_eq!(
        from_header(
            FROM,
            Some("Alice \"Admin\" \\\r\nBcc: victim@example.com\" <x@example.com>")
        ),
        r#""Alice Admin Bcc: victim@example.com <x@example.com> (via Macro)" <no-reply@macro.com>"#
    );
}

#[test]
fn from_header_caps_the_name() {
    let header = from_header(FROM, Some(&"x".repeat(100)));
    assert_eq!(
        header,
        format!("\"{} (via Macro)\" <no-reply@macro.com>", "x".repeat(64))
    );
}

#[test]
fn from_header_encodes_a_non_ascii_name() {
    assert_eq!(
        from_header(FROM, Some("José")),
        "=?UTF-8?Q?Jos=C3=A9_=28via_Macro=29?= <no-reply@macro.com>"
    );
}

#[test]
fn from_header_splits_a_long_non_ascii_name_into_short_encoded_words() {
    let header = from_header(FROM, Some(&"é".repeat(64)));
    let (words, address) = header.rsplit_once(' ').unwrap();
    assert_eq!(address, "<no-reply@macro.com>");

    let words: Vec<&str> = words.split(' ').collect();
    assert!(words.len() > 1);
    for word in &words {
        assert!(word.len() <= 75, "{word} is too long");
        assert!(word.starts_with("=?UTF-8?Q?") && word.ends_with("?="));
        // No character is split across words.
        assert!(!word.ends_with("=C3?="));
    }
    let text: String = words
        .iter()
        .map(|word| &word["=?UTF-8?Q?".len()..word.len() - "?=".len()])
        .collect();
    assert_eq!(text, format!("{}_=28via_Macro=29", "=C3=A9".repeat(64)));
}

#[test]
fn tag_value_keeps_only_characters_ses_accepts() {
    assert_eq!(tag_value("invite_to_team"), "invite_to_team");
    assert_eq!(
        tag_value("email-digest-notification"),
        "email-digest-notification"
    );
    assert_eq!(tag_value("a.b c:d"), "a_b_c_d");
    assert_eq!(tag_value(&"x".repeat(300)).len(), 256);
}

/// The parts of an [`OutgoingEmail`] the adapter decides.
#[derive(Debug, PartialEq, Eq)]
struct Sent {
    from: String,
    to: String,
    reply_to: Option<String>,
    text_body: Option<String>,
    tracking: Option<(String, String)>,
}

#[derive(Default)]
struct RecordingEmailService {
    sent: Mutex<Vec<Sent>>,
}

impl EmailServiceOps for RecordingEmailService {
    async fn send_email(&self, email: &OutgoingEmail<'_>) -> Result<(), Report> {
        self.sent.lock().unwrap().push(Sent {
            from: email.from.clone(),
            to: email.to.to_owned(),
            reply_to: email.reply_to.map(str::to_owned),
            text_body: email.text_body.map(str::to_owned),
            tracking: email.tracking.as_ref().map(|tracking| {
                (
                    tracking.configuration_set.to_owned(),
                    tracking.notification_type.clone(),
                )
            }),
        });
        Ok(())
    }
}

fn recipient() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("bob@example.com").unwrap()
}

#[tokio::test]
async fn sends_on_behalf_of_the_named_sender_with_a_text_part() {
    let adapter = EmailAdapter::new(RecordingEmailService::default(), FROM.to_string(), None);
    let content = EmailContent {
        text: Some("Join us".to_string()),
        from_name: Some("Alice Example".to_string()),
        reply_to: Some(EmailStr::try_from("alice@example.com".to_string()).unwrap()),
        ..EmailContent::new("Subject".to_string(), "<p>Join us</p>".to_string())
    };

    adapter
        .send_email(recipient(), "invite_to_team", &content)
        .await
        .unwrap();

    assert_eq!(
        *adapter.email_service.sent.lock().unwrap(),
        [Sent {
            from: r#""Alice Example (via Macro)" <no-reply@macro.com>"#.to_string(),
            to: "bob@example.com".to_string(),
            reply_to: Some("alice@example.com".to_string()),
            text_body: Some("Join us".to_string()),
            tracking: None,
        }]
    );
}

#[tokio::test]
async fn sends_html_only_emails_from_macro_and_tracks_them_when_configured() {
    let adapter = EmailAdapter::new(
        RecordingEmailService::default(),
        FROM.to_string(),
        Some("notifications".to_string()),
    );
    let content = EmailContent::new("Subject".to_string(), "<p>Hi</p>".to_string());

    adapter
        .send_email(recipient(), "channel_invite", &content)
        .await
        .unwrap();

    assert_eq!(
        *adapter.email_service.sent.lock().unwrap(),
        [Sent {
            from: FROM.to_string(),
            to: "bob@example.com".to_string(),
            reply_to: None,
            text_body: None,
            tracking: Some(("notifications".to_string(), "channel_invite".to_string())),
        }]
    );
}

#[test]
fn email_content_queued_before_the_optional_fields_still_reads() {
    let content: EmailContent =
        serde_json::from_str(r#"{"subject": "Subject", "body": "<p>Hi</p>"}"#).unwrap();

    assert_eq!(content.subject, "Subject");
    assert!(content.text.is_none());
    assert!(content.from_name.is_none());
    assert!(content.reply_to.is_none());
}
