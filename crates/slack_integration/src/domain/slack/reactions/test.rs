use super::*;
use crate::domain::slack::users::ExportUser;

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
