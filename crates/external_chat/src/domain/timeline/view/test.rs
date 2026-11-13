use super::*;
use crate::domain::rich::{Call, CallOutcome, Poll, PollOption, SystemAction};

/// How a provider names an id nobody named: here, a phone number.
fn phone_number(id: &str) -> Option<String> {
    id.strip_suffix("@s.whatsapp.net")
        .map(|number| format!("+{number}"))
}

/// What a provider calls someone it can't name.
const UNKNOWN_PERSON: &str = "Participant";

fn person(name: &str, user: Option<&str>) -> ExternalChatPersonRef {
    ExternalChatPersonRef {
        name: name.to_owned(),
        user_id: user.map(str::to_owned),
    }
}

#[test]
fn mentions_name_people_seen_in_the_group_else_their_number() {
    let mut people = People::new(phone_number, UNKNOWN_PERSON);
    people.learn(
        "15550001111@s.whatsapp.net",
        person("Ana", Some("macro|ana@example.com")),
    );

    let mentions = mentions_view(
        &[
            "15550001111@s.whatsapp.net".to_owned(),
            "15550002222@s.whatsapp.net".to_owned(),
            "987654321@lid".to_owned(),
        ],
        &people,
    );

    assert_eq!(
        mentions,
        vec![
            ExternalChatMention {
                token: "15550001111".to_owned(),
                person: person("Ana", Some("macro|ana@example.com")),
            },
            ExternalChatMention {
                token: "15550002222".to_owned(),
                person: person("+15550002222", None),
            },
            ExternalChatMention {
                token: "987654321".to_owned(),
                person: person(UNKNOWN_PERSON, None),
            },
        ]
    );
}

#[test]
fn a_mention_by_a_bare_id_names_the_person() {
    let mut people = People::new(|_| None, UNKNOWN_PERSON);
    people.learn("U0PARTNER1", person("Ben Partner", None));

    let mentions = mentions_view(&["U0PARTNER1".to_owned(), "U0UNKNOWN1".to_owned()], &people);

    assert_eq!(
        mentions,
        vec![
            ExternalChatMention {
                token: "U0PARTNER1".to_owned(),
                person: person("Ben Partner", None),
            },
            ExternalChatMention {
                token: "U0UNKNOWN1".to_owned(),
                person: person(UNKNOWN_PERSON, None),
            },
        ]
    );
}

#[test]
fn a_poll_tallies_current_votes_per_option_and_marks_the_viewers() {
    let poll = RichContent::Poll(Poll {
        question: "Lunch?".to_owned(),
        options: vec![
            PollOption {
                name: "Pizza".to_owned(),
                hash: "aa".to_owned(),
            },
            PollOption {
                name: "Sushi".to_owned(),
                hash: "bb".to_owned(),
            },
        ],
        selectable_count: 1,
    });
    let message = Uuid::from_u128(1);
    let ana = StoredVote {
        message_id: message,
        selected: vec!["aa".to_owned()],
        voter: StoredPerson {
            person_id: Uuid::from_u128(10),
            user_id: Some("macro|ana@example.com".to_owned()),
        },
    };
    let ben = StoredVote {
        message_id: message,
        selected: vec!["aa".to_owned()],
        voter: StoredPerson {
            person_id: Uuid::from_u128(11),
            user_id: None,
        },
    };
    let mut people = People::new(|_| None, UNKNOWN_PERSON);
    people.name_person(Uuid::from_u128(10), "Ana".to_owned());
    people.name_person(Uuid::from_u128(11), "Ben".to_owned());

    let view = rich_view(
        poll,
        &person("Ana", None),
        &[&ana, &ben],
        "macro|ana@example.com",
        &people,
    );

    assert_eq!(
        view,
        Some(ExternalChatRichContent::Poll(ExternalChatPoll {
            question: "Lunch?".to_owned(),
            options: vec![
                ExternalChatPollOption {
                    name: "Pizza".to_owned(),
                    votes: 2,
                    mine: true,
                    voters: vec![
                        person("Ana", Some("macro|ana@example.com")),
                        person("Ben", None)
                    ],
                },
                ExternalChatPollOption {
                    name: "Sushi".to_owned(),
                    votes: 0,
                    mine: false,
                    voters: vec![],
                },
            ],
            selectable_count: 1,
            voters: 2,
        }))
    );
}

#[test]
fn a_system_line_names_who_did_it_and_to_whom() {
    let mut people = People::new(phone_number, UNKNOWN_PERSON);
    people.learn("15550002222@s.whatsapp.net", person("Ben", None));
    let added = RichContent::System(SystemLine {
        action: SystemAction::ParticipantsAdded,
        participants: vec![
            "15550002222@s.whatsapp.net".to_owned(),
            "15550003333@s.whatsapp.net".to_owned(),
        ],
        value: None,
        call: None,
        by_provider: false,
    });
    let renamed_by_provider = RichContent::System(SystemLine {
        action: SystemAction::SubjectChanged,
        participants: vec![],
        value: Some("Launch".to_owned()),
        call: None,
        by_provider: true,
    });
    let call = RichContent::System(SystemLine {
        action: SystemAction::Call,
        participants: vec![],
        value: None,
        call: Some(Call {
            video: true,
            outcome: CallOutcome::Missed,
            duration_seconds: None,
        }),
        by_provider: false,
    });
    let ana = person("Ana", None);

    assert_eq!(
        rich_view(added, &ana, &[], "viewer", &people),
        Some(ExternalChatRichContent::System(ExternalChatSystemLine {
            action: SystemAction::ParticipantsAdded,
            actor: Some(ana.clone()),
            participants: vec![person("Ben", None), person("+15550003333", None)],
            value: None,
            call: None,
        }))
    );
    assert_eq!(
        rich_view(renamed_by_provider, &ana, &[], "viewer", &people),
        Some(ExternalChatRichContent::System(ExternalChatSystemLine {
            action: SystemAction::SubjectChanged,
            actor: None,
            participants: vec![],
            value: Some("Launch".to_owned()),
            call: None,
        }))
    );
    let Some(ExternalChatRichContent::System(line)) = rich_view(call, &ana, &[], "viewer", &people)
    else {
        panic!("expected a system line");
    };
    assert_eq!(
        line.call,
        Some(Call {
            video: true,
            outcome: CallOutcome::Missed,
            duration_seconds: None,
        })
    );
}

#[test]
fn a_poll_vote_is_never_shown_on_its_own() {
    let vote = RichContent::PollVote(crate::domain::rich::PollVote {
        selected: vec!["aa".to_owned()],
    });

    assert_eq!(
        rich_view(
            vote,
            &person("Ana", None),
            &[],
            "viewer",
            &People::new(|_| None, UNKNOWN_PERSON)
        ),
        None
    );
}

#[test]
fn a_stored_group_created_line_holding_creation_metadata_names_no_subject() {
    let created = RichContent::System(SystemLine {
        action: SystemAction::GroupCreated,
        participants: vec![],
        value: Some(
            r#"{"reason":0,"parent_group_jid":null,"is_open_group":true,"subject":null}"#
                .to_owned(),
        ),
        call: None,
        by_provider: false,
    });
    let ana = person("Ana", Some("macro|ana@example.com"));

    assert_eq!(
        rich_view(
            created,
            &ana,
            &[],
            "viewer",
            &People::new(|_| None, UNKNOWN_PERSON)
        ),
        Some(ExternalChatRichContent::System(ExternalChatSystemLine {
            action: SystemAction::GroupCreated,
            actor: Some(ana.clone()),
            participants: vec![],
            value: None,
            call: None,
        }))
    );
}
