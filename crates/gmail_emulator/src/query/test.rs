use std::collections::BTreeSet;

use super::*;
use crate::mime;

fn parsed() -> Parsed {
    mime::parse(
        b"From: Grace <grace@example.com>\r\nTo: ada@example.com\r\nSubject: Invoice 42\r\n\
        Message-ID: <inv-42@example.com>\r\n\r\nPlease pay by Friday.\r\n",
    )
    .unwrap()
}

/// When the test message was received, in Unix milliseconds.
const RECEIVED_MS: i64 = 1_700_000_000_000;

fn matches(query: &str, held: &[&str]) -> bool {
    let held: BTreeSet<String> = held.iter().map(|label| label.to_string()).collect();
    let labels = [Label {
        id: "Label_1".to_string(),
        name: "Money Stuff".to_string(),
        system: false,
    }];
    Query::parse(query).matches_parsed(&parsed(), &held, &labels, RECEIVED_MS)
}

#[test]
fn operators_words_phrases_and_negation_must_all_match() {
    assert!(matches("rfc822msgid:<inv-42@example.com>", &[]));
    assert!(!matches("rfc822msgid:<other@example.com>", &[]));
    assert!(matches("from:grace subject:invoice friday", &[]));
    assert!(matches("\"pay by friday\" -from:alan", &[]));
    assert!(!matches("from:grace -subject:invoice", &[]));
    assert!(matches(
        "is:unread in:inbox label:money-stuff",
        &["UNREAD", "INBOX", "Label_1"]
    ));
    assert!(!matches("is:read", &["UNREAD"]));
    assert!(!matches("has:attachment", &[]));
}

#[test]
fn after_compares_when_the_message_was_received() {
    assert!(matches("after:1699999940", &[]));
    assert!(!matches("after:1700000000", &[]));
    assert!(!matches("after:1700003600", &[]));
}

#[test]
fn a_filter_reads_after_against_the_time_mail_arrives() {
    let criteria = serde_json::json!({ "query": "after:1700000000" });
    assert!(filter_matches(&criteria, &parsed(), RECEIVED_MS + 1_000));
    assert!(!filter_matches(&criteria, &parsed(), RECEIVED_MS));
}

#[test]
fn only_a_query_naming_spam_or_trash_asks_for_them() {
    assert!(Query::parse("in:trash from:grace").names_spam_or_trash());
    assert!(Query::parse("in:anywhere").names_spam_or_trash());
    assert!(!Query::parse("-in:trash from:grace").names_spam_or_trash());
}
