use super::*;

#[test]
fn direct_message_falls_back_to_the_other_participants_email_local_part() {
    let participants = vec![
        "macro|me@test.com".to_string(),
        "macro|shepherd.hatton@gmail.com".to_string(),
    ];

    let name = resolve_channel_name(
        ChannelType::DirectMessage,
        None,
        Uuid::nil(),
        "macro|me@test.com",
        &participants,
        &NameLookup::new(),
        &HashMap::new(),
    );

    assert_eq!(name, "shepherd.hatton");
}

#[test]
fn unnamed_private_channel_lists_people_and_bots_but_not_the_viewer() {
    let participants = vec![
        "macro|me@test.com".to_string(),
        "macro|gabriel@test.com".to_string(),
        format!("bot|{}", bot_id::CODEX_BOT_ID),
    ];
    let mut user_names = NameLookup::new();
    user_names.insert(
        MacroUserIdStr::try_from("macro|gabriel@test.com".to_string()).unwrap(),
        "Gabriel Birman".to_string(),
    );
    let bot_names = HashMap::from([(bot_id::CODEX_BOT_ID, "Codex".to_string())]);

    let name = resolve_channel_name(
        ChannelType::Private,
        Some("  "),
        Uuid::nil(),
        "macro|me@test.com",
        &participants,
        &user_names,
        &bot_names,
    );

    assert_eq!(name, "Codex, Gabriel Birman");
}
