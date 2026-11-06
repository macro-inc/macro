use super::vcard;

#[test]
fn a_vcard_gives_its_name_and_phone_numbers() {
    let card = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\n\
        item1.TEL;waid=15550001111:+1 555-000-1111\r\nitem1.X-ABLabel:Mobile\r\n\
        TEL;TYPE=WORK:+44 20 7946 0000\r\nEND:VCARD";

    let (name, phones) = vcard(card);

    assert_eq!(name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(phones, vec!["+1 555-000-1111", "+44 20 7946 0000"]);
}

/// Newer phones give a created group's metadata as JSON, not its subject.
#[test]
fn a_history_group_create_stub_names_the_subject_not_the_metadata() {
    let created = |parameter: &str| {
        super::stub_line(&whatsmeow::proto::wa_web::WebMessageInfo {
            message_stub_type: Some(
                whatsmeow::proto::wa_web::web_message_info::StubType::GroupCreate as i32,
            ),
            message_stub_parameters: vec![parameter.to_owned()],
            ..Default::default()
        })
        .unwrap()
    };

    let metadata = created(
        r#"{"reason":0,"parent_group_jid":null,"is_open_group":true,"subject":null,"author":"123456789@lid"}"#,
    );
    let subject = created("Launch");

    assert_eq!(
        metadata.action,
        external_chat::domain::rich::SystemAction::GroupCreated
    );
    assert_eq!(metadata.value, None);
    assert_eq!(subject.value.as_deref(), Some("Launch"));
}
