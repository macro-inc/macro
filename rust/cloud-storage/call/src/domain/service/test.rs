use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;

use super::{exclude_voip_recipients, extract_recording_key};

fn user(email: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[test]
fn extract_key_from_full_s3_url() {
    let url = "https://macro-call-recording-prod.s3.amazonaws.com/calls/0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4";
    assert_eq!(
        extract_recording_key(url),
        "0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4"
    );
}

#[test]
fn extract_key_fallback_when_no_calls_prefix() {
    let url = "s3://bucket/some/other/path.mp4";
    assert_eq!(extract_recording_key(url), url);
}

#[test]
fn extract_key_from_bare_calls_path() {
    let url = "calls/abc-123/recording.mp4";
    assert_eq!(extract_recording_key(url), "abc-123/recording.mp4");
}

#[test]
fn exclude_voip_recipients_keeps_users_without_voip_delivery() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert_eq!(filtered, HashSet::from([bob]));
}

#[test]
fn exclude_voip_recipients_returns_empty_when_all_users_received_voip() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice, bob]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert!(filtered.is_empty());
}
