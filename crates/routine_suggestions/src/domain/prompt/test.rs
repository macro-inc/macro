use chrono::TimeZone;

use super::*;

fn message(snippet: &str) -> InboxMessage {
    InboxMessage {
        inbox: "me@example.com".to_owned(),
        from_name: Some("Acme Billing".to_owned()),
        from_email: Some("billing@acme.test".to_owned()),
        others: Vec::new(),
        subject: Some("Invoice 42".to_owned()),
        snippet: Some(snippet.to_owned()),
        received_at: None,
    }
}

#[test]
fn lists_every_surface_and_the_inbox_as_data() {
    let now = Utc.with_ymd_and_hms(2026, 10, 27, 9, 0, 0).unwrap();

    let prompt = user_prompt(now, &[message("Your invoice is attached")]);

    for surface in RoutineSurface::iter() {
        assert!(prompt.contains(&format!("- {surface}: {}", surface.focus())));
    }
    assert!(prompt.contains("Tuesday 2026-10-27"));
    assert!(prompt.contains("(1, newest first)"));
    assert!(prompt.contains(r#""from_email": "billing@acme.test""#));
    assert!(!prompt.contains("others"), "empty fields are left out");
}

#[test]
fn shortens_long_snippets() {
    let long = "a".repeat(MAX_SNIPPET_CHARS + 50);

    let prompt = user_prompt(Utc::now(), &[message(&long)]);

    assert!(prompt.contains(&format!("{}…", "a".repeat(MAX_SNIPPET_CHARS))));
    assert!(!prompt.contains(&"a".repeat(MAX_SNIPPET_CHARS + 1)));
}

#[test]
fn truncates_on_character_boundaries() {
    assert_eq!(truncate(" ééé ", 2), "éé…");
    assert_eq!(truncate("éé", 2), "éé");
}
