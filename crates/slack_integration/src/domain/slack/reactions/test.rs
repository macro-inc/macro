use super::*;
use crate::domain::slack::users::ExportUser;

#[test]
fn slack_aliases_match_canonical_frontend_unicode() {
    for (names, expected) in [
        (&["+1", "thumbsup"][..], "\u{1f44d}"),
        (&["-1", "thumbsdown"][..], "\u{1f44e}"),
        (&["hankey", "poop", "shit"][..], "\u{1f4a9}"),
        (&["email", "envelope"][..], "\u{2709}\u{fe0f}"),
        (&["us", "flag-us"][..], "\u{1f1fa}\u{1f1f8}"),
        (&["heart"][..], "\u{2764}\u{fe0f}"),
        (&["thinking_face"][..], "\u{1f914}"),
    ] {
        for name in names {
            assert_eq!(shortcode(name), Some(expected), "{name}");
        }
    }
    assert!(SHORTCODES.len() > 2000);
    assert!(SHORTCODES.values().all(|value| {
        !value
            .chars()
            .any(|c| ('\u{1f3fb}'..='\u{1f3ff}').contains(&c))
    }));
}

#[test]
fn valid_skin_tones_strip_but_custom_names_do_not_guess() {
    for name in [
        "thumbsup::skin-tone-2",
        "+1::skin-tone-6",
        ":thumbsup::skin-tone-3:",
        "thumbsup::skin-tone-2::skin-tone-6",
        ":+1:",
    ] {
        assert_eq!(shortcode(name), shortcode("thumbsup"));
    }
    for name in [
        "custom_company",
        "party_parrot",
        "thumbsup::skin-tone-7",
        "thumbsup::skin-tone-2::custom",
        "thumbsup:custom",
        "skin-tone-2",
        "",
        "::",
        "THUMBSUP",
    ] {
        assert_eq!(shortcode(name), None, "{name}");
    }
}

#[test]
fn reactors_dedupe_after_email_alias_and_tone_mapping_with_exact_times() {
    let users = UserDirectory::new(
        serde_json::from_str::<Vec<ExportUser>>(
            r#"[
        {"id":"U1","profile":{"email":"A+tag@Example.com"}},
        {"id":"U2","profile":{"email":"a+tag@example.com"}},
        {"id":"U3","profile":{"email":"a@example.com"}},
        {"id":"U4","profile":{"display_name":"No Email"}},
        {"id":"U5","is_bot":true,"profile":{"email":"bot@example.com"}}
    ]"#,
        )
        .unwrap(),
    )
    .unwrap();
    let reactions: Vec<ExportReaction> = serde_json::from_str(
        r#"[
        {"name":"thumbsup::skin-tone-3","users":["U1","U1","U2","U3","U4","U5","U404"],"count":999},
        {"name":"+1","users":["U2"],"ts":"1700000000.000002"},
        {"name":"thumbsup","users":["U2"],"ts":"1700000000.000001"},
        {"name":"heart","users":["U1"]},
        {"name":"custom_company","users":["U1"]}
    ]"#,
    )
    .unwrap();
    let message_time = "1700000000.000000".parse().unwrap();
    let converted = convert(&reactions, &users, message_time);
    assert_eq!(converted.len(), 3);
    assert!(converted.iter().all(|r| r.created_at == message_time));
    assert_eq!(
        converted
            .iter()
            .filter(|r| r.user_id.as_ref() == "macro|a+tag@example.com")
            .count(),
        2
    );
    assert_eq!(
        converted
            .iter()
            .filter(|r| r.user_id.as_ref() == "macro|a@example.com")
            .count(),
        1
    );
    let explicit = convert(&reactions[1..3], &users, message_time);
    assert_eq!(explicit.len(), 1);
    assert_eq!(explicit[0].created_at, "1700000000.000001".parse().unwrap());
    let mut reversed = reactions.clone();
    reversed.reverse();
    let snapshot = |values: Vec<HistoricalReaction>| {
        values
            .into_iter()
            .map(|r| (r.user_id, r.emoji, r.created_at))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        snapshot(converted),
        snapshot(convert(&reversed, &users, message_time))
    );
}
