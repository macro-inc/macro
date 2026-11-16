use super::*;
const EMBEDDED_URL: &str = "https://mail.google.com/mail/u/0?ui=2&ik=0a1b2c3d4e&attid=0.1&permmsgid=msg-f:1849112233445566778&th=19a95dc7805a293a&view=fimg&fur=ip&permmsgid=msg-f:1849112233445566778&sz=s0-l75-ft&attbid=ANGjdJ_example&disp=emb&realattid=ii_0000000000000000a1b2&zw";
const MESSAGE_ID: &str = "19a95dc7805a293a";
const CONTENT_ID: &str = "ii_0000000000000000a1b2";
const THREAD_ID: &str = "19a95dc7805a0001";
const SENT_CONTENT_ID: &str = "ii_0000000000000000e5f6";
fn embedded_url(location: &str, content_id: &str) -> String {
    format!(
        "https://mail.google.com/mail/u/0?ui=2&ik=0a1b2c3d4e&attid=0.1&{location}&view=fimg&disp=emb&realattid={content_id}&attbid=ANGjdJ_example"
    )
}

#[test]
fn parses_message_and_part_from_embedded_url() {
    assert_eq!(
        GmailMessageImage::parse(EMBEDDED_URL),
        Some(GmailMessageImage {
            location: ImageLocation::Message(MESSAGE_ID.to_string()),
            content_id: CONTENT_ID.to_string(),
        })
    );
}

#[test]
fn looks_in_the_thread_without_a_permanent_message_id() {
    for location in [
        format!("th={THREAD_ID}"),
        format!("permmsgid=msg-a:r-1234567890&th={THREAD_ID}"),
    ] {
        assert_eq!(
            GmailMessageImage::parse(&embedded_url(&location, SENT_CONTENT_ID)),
            Some(GmailMessageImage {
                location: ImageLocation::Thread(THREAD_ID.to_string()),
                content_id: SENT_CONTENT_ID.to_string(),
            }),
            "{location}"
        );
    }
}

#[test]
fn ignores_urls_that_are_not_gmail_embedded_images() {
    for url in [
        "https://example.com/logo.png",
        "https://ci3.googleusercontent.com/mail-sig/AIorK4z",
        // No part to look for.
        "https://mail.google.com/mail/u/0?ui=2&permmsgid=msg-f:1849112233445566778&view=fimg",
        // Not over HTTPS.
        "http://mail.google.com/mail/u/0?permmsgid=msg-f:1849112233445566778&realattid=ii_1",
        // An id that isn't Gmail's hex id never reaches the API path.
        "https://mail.google.com/mail/u/0?th=..%2Fdrafts&realattid=ii_1",
        "https://mail.google.com/mail/u/0?permmsgid=msg-a:r-123&realattid=ii_1",
    ] {
        assert_eq!(GmailMessageImage::parse(url), None, "{url}");
    }
}
