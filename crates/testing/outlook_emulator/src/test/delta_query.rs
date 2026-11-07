//! A folder delta's `$orderby=receivedDateTime desc` and `receivedDateTime`
//! `$filter`, read by a plain HTTP client: the real client does not send them.

use chrono::{DateTime, Utc};
use serde_json::Value;
use url::Url;

use super::{ADA, message_id, start};
use crate::{MessageChange, NewMessage, OutlookEmulator};

const NEWEST_FIRST: (&str, &str) = ("$orderby", "receivedDateTime desc");
const SELECT: (&str, &str) = ("$select", "subject,receivedDateTime");

fn inbox_delta(emulator: &OutlookEmulator, options: &[(&str, &str)]) -> String {
    let delta = format!(
        "{}/v1.0/me/mailFolders/inbox/messages/delta",
        emulator.base_url()
    );
    Url::parse_with_params(&delta, options).unwrap().to_string()
}

/// Reads a delta round by following its links, `page_size` entries a page:
/// each page's entries, and the delta link the round ends with. Every link
/// carries only its token, so the token alone keeps the first request's
/// options.
async fn read_round(
    emulator: &OutlookEmulator,
    first: String,
    page_size: usize,
) -> (Vec<Vec<Value>>, String) {
    let http = reqwest::Client::new();
    let access_token = emulator.access_token(ADA).unwrap();
    let mut url = first;
    let mut pages = Vec::new();
    loop {
        let page: Value = http
            .get(&url)
            .bearer_auth(&access_token)
            .header("Prefer", format!("odata.maxpagesize={page_size}"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        pages.push(page["value"].as_array().unwrap().clone());
        let next = page["@odata.nextLink"].as_str();
        let (link, token) = match next {
            Some(next) => (next, "$skiptoken"),
            None => (page["@odata.deltaLink"].as_str().unwrap(), "$deltatoken"),
        };
        let names: Vec<String> = Url::parse(link)
            .unwrap()
            .query_pairs()
            .map(|(name, _)| name.into_owned())
            .collect();
        assert_eq!(names, vec![token.to_string()]);
        if next.is_none() {
            return (pages, link.to_string());
        }
        url = link.to_string();
    }
}

fn subjects(entries: &[Value]) -> Vec<&str> {
    entries
        .iter()
        .map(|entry| entry["subject"].as_str().unwrap())
        .collect()
}

/// Delivers a message received at `date`, as mail that arrived late or was
/// imported.
fn deliver(emulator: &OutlookEmulator, subject: &str, date: Option<&str>) -> String {
    let message = NewMessage {
        subject: Some(subject.into()),
        date: date.map(|date| date.parse().unwrap()),
        ..NewMessage::default()
    };
    emulator.deliver(ADA, &message).unwrap().id
}

#[tokio::test]
async fn a_newest_first_round_pages_by_received_time_without_gaps_or_repeats() {
    // 23 messages over 20 hours, stored out of order: hours 0, 7 and 14
    // each hold two.
    let mut seed = format!("mailboxes:\n  - email: {ADA}\n    messages:\n");
    for index in 0..23 {
        let hour = index * 7 % 20;
        seed.push_str(&format!(
            "      - {{ subject: Message {index:03}, date: \"2026-11-02T{hour:02}:00:00Z\" }}\n"
        ));
    }
    let (emulator, _api) = start(&seed).await;

    let first = inbox_delta(&emulator, &[NEWEST_FIRST, SELECT]);
    let (pages, _) = read_round(&emulator, first, 10).await;

    let sizes: Vec<usize> = pages.iter().map(Vec::len).collect();
    assert_eq!(sizes, vec![10, 10, 3]);
    let entries: Vec<(DateTime<Utc>, &str)> = pages
        .iter()
        .flatten()
        .map(|entry| {
            let received = entry["receivedDateTime"].as_str().unwrap();
            (received.parse().unwrap(), entry["id"].as_str().unwrap())
        })
        .collect();
    for pair in entries.windows(2) {
        let ((newer, first_id), (older, second_id)) = (pair[0], pair[1]);
        assert!(newer > older || (newer == older && first_id < second_id));
    }
    let newest = subjects(&pages[0]);
    assert_eq!(newest[..3], ["Message 017", "Message 014", "Message 011"]);

    // `$top` keeps the newest, and the next round does not report the rest.
    let capped = inbox_delta(&emulator, &[NEWEST_FIRST, SELECT, ("$top", "4")]);
    let (pages, checkpoint) = read_round(&emulator, capped, 10).await;
    assert_eq!(
        subjects(&pages[0]),
        ["Message 017", "Message 014", "Message 011", "Message 008"]
    );
    let (after, _) = read_round(&emulator, checkpoint, 10).await;
    assert_eq!(after, vec![Vec::<Value>::new()]);
}

#[tokio::test]
async fn later_rounds_of_a_newest_first_delta_list_newest_first_too() {
    let seed = format!(
        "mailboxes:\n  - email: {ADA}\n    messages:\n      - {{ subject: Seeded, date: \"2026-11-01T09:00:00Z\" }}\n"
    );
    let (emulator, _api) = start(&seed).await;
    let first = inbox_delta(&emulator, &[NEWEST_FIRST, SELECT]);
    let (_, checkpoint) = read_round(&emulator, first, 10).await;

    deliver(&emulator, "Delivered first", Some("2026-11-02T09:00:00Z"));
    deliver(&emulator, "Delivered second", Some("2026-11-03T09:00:00Z"));
    deliver(&emulator, "Delivered third", Some("2026-11-02T12:00:00Z"));

    let (pages, _) = read_round(&emulator, checkpoint, 2).await;
    let listed: Vec<&str> = pages.iter().flat_map(|page| subjects(page)).collect();
    assert_eq!(
        listed,
        ["Delivered second", "Delivered third", "Delivered first"]
    );
}

#[tokio::test]
async fn a_received_filter_admits_its_bound_with_ge_but_not_with_gt() {
    let seed = format!(
        r#"
mailboxes:
  - email: {ADA}
    messages:
      - {{ subject: Before, date: "2026-11-02T08:59:59Z" }}
      - {{ subject: At, date: "2026-11-02T09:00:00Z" }}
      - {{ subject: After, date: "2026-11-02T09:00:01Z" }}
"#
    );
    let (emulator, _api) = start(&seed).await;

    let ge = ("$filter", "receivedDateTime ge 2026-11-02T09:00:00Z");
    let (pages, _) = read_round(&emulator, inbox_delta(&emulator, &[NEWEST_FIRST, ge]), 10).await;
    assert_eq!(subjects(&pages[0]), ["After", "At"]);

    let gt = ("$filter", "receivedDateTime gt 2026-11-02T09:00:00Z");
    let (pages, _) = read_round(&emulator, inbox_delta(&emulator, &[gt]), 10).await;
    assert_eq!(subjects(&pages[0]), ["After"]);
}

#[tokio::test]
async fn a_filtered_delta_reports_changes_to_mail_it_admits_and_every_removal() {
    let seed = format!(
        r#"
mailboxes:
  - email: {ADA}
    messages:
      - {{ subject: Old read, date: "2001-01-01T09:00:00Z" }}
      - {{ subject: Old deleted, date: "2001-01-02T09:00:00Z" }}
      - {{ subject: Recent read, date: "2020-01-01T09:00:00Z" }}
      - {{ subject: Recent moved, date: "2020-01-02T09:00:00Z" }}
"#
    );
    let (emulator, _api) = start(&seed).await;
    let since = ("$filter", "receivedDateTime ge 2010-01-01T00:00:00Z");
    let first = inbox_delta(&emulator, &[NEWEST_FIRST, since]);
    let (pages, checkpoint) = read_round(&emulator, first, 10).await;
    assert_eq!(subjects(&pages[0]), ["Recent moved", "Recent read"]);

    let mark_read = MessageChange {
        read: Some(true),
        ..MessageChange::default()
    };
    let to_archive = MessageChange {
        folder: Some("archive".into()),
        ..MessageChange::default()
    };
    let old_read = message_id(&emulator, ADA, "Old read");
    let old_deleted = message_id(&emulator, ADA, "Old deleted");
    let recent_read = message_id(&emulator, ADA, "Recent read");
    let recent_moved = message_id(&emulator, ADA, "Recent moved");
    emulator
        .update_message(ADA, old_read.as_str(), &mark_read)
        .unwrap();
    emulator.delete_message(ADA, old_deleted.as_str()).unwrap();
    emulator
        .update_message(ADA, recent_read.as_str(), &mark_read)
        .unwrap();
    emulator
        .update_message(ADA, recent_moved.as_str(), &to_archive)
        .unwrap();
    // Delivered now, after the bound; the backdated one is before it.
    deliver(&emulator, "New mail", None);
    deliver(&emulator, "Backdated", Some("2002-01-01T09:00:00Z"));

    let (pages, checkpoint) = read_round(&emulator, checkpoint, 10).await;
    let entries: Vec<&Value> = pages.iter().flatten().collect();
    let changed: Vec<&str> = entries
        .iter()
        .filter_map(|entry| entry["subject"].as_str())
        .collect();
    let removed: Vec<&str> = entries
        .iter()
        .filter(|entry| entry.get("@removed").is_some())
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert_eq!(changed, ["New mail", "Recent read"]);
    assert_eq!(removed, [recent_moved.as_str(), old_deleted.as_str()]);

    let (pages, _) = read_round(&emulator, checkpoint, 10).await;
    assert_eq!(pages, vec![Vec::<Value>::new()]);
}

#[tokio::test]
async fn a_filtered_round_lists_at_most_five_thousand_messages() {
    let mut seed = format!("mailboxes:\n  - email: {ADA}\n    messages:\n");
    for index in 0..5_001 {
        seed.push_str(&format!(
            "      - {{ subject: Message {index:04}, date: \"2026-11-02T00:00:00Z\" }}\n"
        ));
    }
    let (emulator, _api) = start(&seed).await;
    let since = ("$filter", "receivedDateTime ge 2026-11-01T00:00:00Z");

    let (pages, checkpoint) = read_round(&emulator, inbox_delta(&emulator, &[since]), 1_000).await;

    assert_eq!(pages.iter().map(Vec::len).sum::<usize>(), 5_000);
    let (pages, _) = read_round(&emulator, checkpoint, 1_000).await;
    assert_eq!(pages, vec![Vec::<Value>::new()]);
}

#[tokio::test]
async fn a_delta_refuses_any_other_order_or_filter() {
    let (emulator, _api) = start(&format!("mailboxes:\n  - email: {ADA}\n")).await;
    let http = reqwest::Client::new();
    let access_token = emulator.access_token(ADA).unwrap();
    let order = "Invalid $orderby clause: a message delta query orders only by \
                 receivedDateTime desc.";
    let filter = "Invalid filter clause: a message delta query filters only by receivedDateTime ge \
                  or gt a date and time.";
    let unparsed = "Invalid filter clause: the emulator does not support this $filter.";
    let refused = [
        (("$orderby", "receivedDateTime"), order),
        (("$orderby", "receivedDateTime asc"), order),
        (("$orderby", "sentDateTime desc"), order),
        (("$filter", "sentDateTime ge 2026-11-01T00:00:00Z"), filter),
        (("$filter", "isRead eq false"), filter),
        (
            ("$filter", "receivedDateTime lt 2026-11-01T00:00:00Z"),
            unparsed,
        ),
        (("$filter", "receivedDateTime ge yesterday"), unparsed),
    ];

    for (option, message) in refused {
        let response = http
            .get(inbox_delta(&emulator, &[option]))
            .bearer_auth(&access_token)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{option:?}");
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["error"]["message"], message, "{option:?}");
    }
}
