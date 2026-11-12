use contacts::domain::models::{
    contact::{Contact, ContactId},
    people::PersonMatch,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_search::names::NamedItem;

use super::person_candidate;

const VIEWER: &str = "macro|viewer@example.com";
const PERSON: &str = "macro|ada@example.com";

fn person(name: Option<&str>) -> PersonMatch {
    let viewer = MacroUserIdStr::try_from(VIEWER.to_string()).expect("viewer id");
    let user_id = MacroUserIdStr::try_from(PERSON.to_string()).expect("person id");
    PersonMatch {
        contact: Contact {
            id: ContactId::for_viewer(&viewer, &user_id),
            user_id,
            name: name.map(str::to_string),
        },
        is_teammate: true,
        is_agent: false,
    }
}

#[test]
fn a_named_person_answers_to_their_first_name_and_email() {
    let candidate = person_candidate(person(Some("Ada Lovelace")));

    assert_eq!(
        candidate.item,
        NamedItem::Person {
            id: MacroUserIdStr::try_from(PERSON.to_string()).expect("person id"),
        }
    );
    assert_eq!(candidate.name, "Ada Lovelace");
    assert_eq!(candidate.aliases, vec!["Ada", "ada@example.com"]);
}

#[test]
fn a_one_word_name_is_not_repeated_as_an_alias() {
    let candidate = person_candidate(person(Some("Ada")));

    assert_eq!(candidate.name, "Ada");
    assert_eq!(candidate.aliases, vec!["ada@example.com"]);
}

#[test]
fn a_person_without_a_name_goes_by_their_email() {
    for name in [None, Some("  ")] {
        let candidate = person_candidate(person(name));

        assert_eq!(candidate.name, "ada@example.com");
        assert!(candidate.aliases.is_empty());
    }
}
