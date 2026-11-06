use super::*;
use hmac::Mac;
use sha2::Sha256;

#[test]
fn unsubscribe_url_keeps_gateway_prefix() {
    let url = signing::append_path(
        NotificationServiceUrl::default_for_environment(Environment::Production)
            .parse_url()
            .unwrap(),
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    assert_eq!(
        url.as_str(),
        "https://gateway.macro.com/notification/user_notifications/preferences/email-digest-notification/disable"
    );
}

#[test]
fn digest_logo_keeps_the_png_aspect_ratio() {
    let unsubscribe_url = SignedUrl::new(
        NotificationServiceUrl::default_for_environment(Environment::Production)
            .parse_url()
            .unwrap(),
        Hmac::<Sha256>::new_from_slice(b"test-secret").unwrap(),
    );
    let html = DigestTemplate {
        notifs: Vec::new(),
        num_truncated: 0,
        total_count: 0,
        unsubscribe_url,
    }
    .render()
    .unwrap();
    let html = html.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(html.contains(
        r#"src="https://static-file-service.macro.com/file/b911aba9-94a6-435c-aa16-8404739f13b0" width="54" height="36""#
    ));
}

#[test]
fn digest_escapes_nameless_mention_placeholders() {
    use model_notifications::{
        ChannelMessageSendMetadata, ChannelType, CommonChannelMetadata, NotificationTitle,
    };

    let event = NotifEvent::ChannelMessageSend(ChannelMessageSendMetadata {
        sender: None,
        sender_display_name: Some("Helper Bot".to_string()),
        message_content: r#"Filed <m-document-mention>{"documentId":"t1","documentName":"","blockName":"task","blockParams":{}}</m-document-mention>"#.to_string(),
        message_id: "m1".to_string(),
        has_attachments: false,
        common: CommonChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "AI Team".to_string(),
        },
        sender_profile_picture_url: None,
    });
    let notif = NotifPreview {
        created_at: Utc::now(),
        title: event.format_title(None).unwrap(),
        body: event.format_body(None).unwrap(),
    };
    assert_eq!(notif.body, "Filed <task>");

    let html = DigestTemplate {
        notifs: vec![notif],
        num_truncated: 0,
        total_count: 1,
        unsubscribe_url: SignedUrl::new(
            NotificationServiceUrl::default_for_environment(Environment::Production)
                .parse_url()
                .unwrap(),
            Hmac::<Sha256>::new_from_slice(b"test-secret").unwrap(),
        ),
    }
    .render()
    .unwrap();
    assert!(html.contains("Filed &#60;task&#62;"));
    assert!(!html.contains("<task>"));
}

#[test]
fn signed_unsubscribe_roundtrips_against_request_url() {
    let secret = Hmac::<Sha256>::new_from_slice(b"test-secret").unwrap();
    let mut unsigned = signing::append_path(
        NotificationServiceUrl::default_for_environment(Environment::Production)
            .parse_url()
            .unwrap(),
        "/user_notifications/preferences/email-digest-notification/disable",
    );
    unsigned
        .query_pairs_mut()
        .append_pair("id", "macro|user@example.com");
    let signed = SignedUrl::new(unsigned, secret.clone());

    let reconstructed =
        signing::public_request_url("https", "gateway.macro.com", signed.as_ref().path()).unwrap();
    let mut to_verify = reconstructed;
    to_verify.set_query(signed.as_ref().query());

    assert!(SignedUrl::verify(to_verify, secret).is_some());
    assert!(
        signed
            .as_ref()
            .as_str()
            .contains("/notification/user_notifications/")
    );
}
