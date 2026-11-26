use super::*;
use crate::domain::models::people::NamedPeopleQuery;

fn named(text: &str) -> NamedPeopleQuery {
    NamedPeopleQuery::new(text).unwrap()
}

fn limit(value: u32) -> PeopleSearchLimit {
    PeopleSearchLimit::new(value).unwrap()
}

/// Each match's address, name and lists.
fn summary(people: &[PersonMatch]) -> Vec<(&str, Option<&str>, Vec<ContactList>)> {
    people
        .iter()
        .map(|person| {
            (
                person.contact.user_id.email_str(),
                person.contact.name.as_deref(),
                person.contact.lists.clone(),
            )
        })
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn named_people_rank_by_list_group_then_exact_names_then_ids(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let people = repository
        .name_listed_people(mid(VIEWER), &named("sam"), limit(50))
        .await
        .unwrap();

    // Interacted and invited lead, teammates follow, then inbox contacts. g is
    // in Gmail too but ranks with Interacted, its best group. "Bo Osam" only
    // contains the text. An empty profile name hides the label, as the
    // directory's names do, so the address's local part names that person.
    assert_eq!(
        summary(&people),
        [
            (
                "a@example.com",
                Some("Sam Able"),
                vec![ContactList::Interacted]
            ),
            (
                "g@example.com",
                Some("Sam Gee"),
                vec![ContactList::Gmail, ContactList::Interacted]
            ),
            (
                "t@example.com",
                Some("Zed Samuels"),
                vec![ContactList::Teammates]
            ),
            ("d@example.com", Some("Sam Dee"), vec![ContactList::Gmail]),
            (
                "sam.o@example.org",
                Some("Sammy Book"),
                vec![ContactList::Outlook]
            ),
            ("samuel.e@example.org", None, vec![ContactList::Gmail]),
        ]
    );

    let first = repository
        .name_listed_people(mid(VIEWER), &named("sam"), limit(2))
        .await
        .unwrap();
    assert_eq!(
        summary(&first)
            .into_iter()
            .map(|(email, _, _)| email)
            .collect::<Vec<_>>(),
        ["a@example.com", "g@example.com"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn exact_names_lead_their_group(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let people = repository
        .name_listed_people(mid(VIEWER), &named("sam d"), limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&people),
        [("d@example.com", Some("Sam Dee"), vec![ContactList::Gmail])]
    );

    let people = repository
        .name_listed_people(mid(VIEWER), &named("sammy book"), limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&people),
        [(
            "sam.o@example.org",
            Some("Sammy Book"),
            vec![ContactList::Outlook]
        )]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn named_people_come_only_from_the_viewers_own_directory(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    // r has the viewer in `interacted`; the viewer does not have r, and x is
    // in nobody's lists.
    for text in ["sam reverse", "sam stranger"] {
        let people = repository
            .name_listed_people(mid(VIEWER), &named(text), limit(50))
            .await
            .unwrap();
        assert!(people.is_empty(), "{text}");
    }
    let found = repository
        .name_listed_people(mid("macro|r@example.com"), &named("viewer"), limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&found),
        [(
            "v@example.com",
            Some("Viewer Person"),
            vec![ContactList::Interacted]
        )]
    );

    // The viewer ranks with their team and has no lists.
    let own = repository
        .name_listed_people(mid(VIEWER), &named("viewer p"), limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&own),
        [("v@example.com", Some("Viewer Person"), vec![])]
    );
}
