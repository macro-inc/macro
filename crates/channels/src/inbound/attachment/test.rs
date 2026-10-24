use super::*;
use chrono::{DateTime, Utc};

fn message(sender_id: &str, content: &str) -> RecentChannelMessage {
    let at: DateTime<Utc> = DateTime::from_timestamp(1_700_000_000, 0).unwrap();
    RecentChannelMessage {
        message_id: Uuid::nil(),
        thread_id: None,
        sender_id: sender_id.to_owned(),
        content: content.to_owned(),
        created_at: at,
        updated_at: at,
        deleted_at: None,
        mentions: vec![],
    }
}

fn person(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

#[test]
fn names_people_beside_their_ids() {
    let names = SenderNames::from([(person("macro|gab@macro.com"), "Pine Martin".to_owned())]);
    let body = format_messages(
        &[
            message("macro|gab@macro.com", "hello"),
            message("macro|nameless@macro.com", "hi"),
            message("bot|00000000-0000-0000-0000-000000000001", "beep"),
        ],
        &names,
    );

    let tags: Vec<_> = body.lines().filter(|line| line.starts_with('<')).collect();
    assert_eq!(
        tags,
        [
            r#"<message sender=macro|gab@macro.com sender-name="Pine Martin" timestamp=2023-11-14 22:13>"#,
            "</message>",
            "<message sender=macro|nameless@macro.com timestamp=2023-11-14 22:13>",
            "</message>",
            "<message sender=bot|00000000-0000-0000-0000-000000000001 timestamp=2023-11-14 22:13>",
            "</message>",
        ]
    );
}

#[test]
fn escapes_a_name_inside_the_attribute() {
    let names = SenderNames::from([(
        person("macro|gab@macro.com"),
        r#"Pine "Pi" <Martin>"#.to_owned(),
    )]);
    let body = format_messages(&[message("macro|gab@macro.com", "hello")], &names);

    assert!(
        body.contains(r#"sender-name="Pine &quot;Pi&quot; &lt;Martin&gt;""#),
        "{body}"
    );
}

#[test]
fn looks_up_people_only() {
    let people: HashSet<_> = [
        message("macro|gab@macro.com", "a"),
        message("macro|gab@macro.com", "b"),
        message("bot|00000000-0000-0000-0000-000000000001", "c"),
    ]
    .iter()
    .filter_map(sender)
    .collect();

    assert_eq!(people, HashSet::from([person("macro|gab@macro.com")]));
}
