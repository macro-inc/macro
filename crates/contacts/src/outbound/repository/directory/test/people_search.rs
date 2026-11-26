use super::*;

fn limit(value: u32) -> PeopleSearchLimit {
    PeopleSearchLimit::new(value).unwrap()
}

/// Each match's address, name, lists and whether they are a teammate.
fn summary(people: &[PersonMatch]) -> Vec<(&str, Option<&str>, Vec<ContactList>, bool)> {
    people
        .iter()
        .map(|person| {
            (
                person.contact.user_id.email_str(),
                person.contact.name.as_deref(),
                person.contact.lists.clone(),
                person.is_teammate,
            )
        })
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn search_ranks_by_list_group_then_prefix_then_name(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let people = repository
        .search_listed_people(mid(VIEWER), "sam", limit(50))
        .await
        .unwrap();

    // g is in Gmail too but ranks with Interacted, its best group; n's name
    // only contains the query, so it follows the prefix matches. r has the
    // viewer but is not in the viewer's lists; x is in nobody's.
    assert_eq!(
        summary(&people),
        [
            (
                "t@example.com",
                Some("Zed Samuels"),
                vec![ContactList::Teammates],
                true
            ),
            (
                "a@example.com",
                Some("Sam Able"),
                vec![ContactList::Interacted],
                false
            ),
            (
                "g@example.com",
                Some("Sam Gee"),
                vec![ContactList::Gmail, ContactList::Interacted],
                false
            ),
            (
                "n@example.com",
                Some("Bo Osam"),
                vec![ContactList::Invited],
                false
            ),
            (
                "d@example.com",
                Some("Sam Dee"),
                vec![ContactList::Gmail],
                false
            ),
            (
                "sam.o@example.org",
                Some("Sammy Book"),
                vec![ContactList::Outlook],
                false
            ),
            (
                "samuel.e@example.org",
                Some("Eve Label"),
                vec![ContactList::Gmail],
                false
            ),
        ]
    );

    let first = repository
        .search_listed_people(mid(VIEWER), "sam", limit(2))
        .await
        .unwrap();
    assert_eq!(
        first
            .iter()
            .map(|person| person.contact.user_id.email_str())
            .collect::<Vec<_>>(),
        ["t@example.com", "a@example.com"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn the_viewer_ranks_with_their_team_and_has_no_lists(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let people = repository
        .search_listed_people(mid(VIEWER), "viewer", limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&people),
        [("v@example.com", Some("Viewer Person"), vec![], true)]
    );

    // Without a team the viewer is in no group and is still found.
    let reverse = repository
        .search_listed_people(mid("macro|r@example.com"), "reverse", limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&reverse),
        [("r@example.com", Some("Sam Reverse"), vec![], false)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn a_directed_row_is_searchable_only_by_its_owner(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    // r has the viewer in `interacted`; the viewer does not have r.
    let found = repository
        .search_listed_people(mid("macro|r@example.com"), "viewer", limit(50))
        .await
        .unwrap();
    assert_eq!(
        summary(&found),
        [(
            "v@example.com",
            Some("Viewer Person"),
            vec![ContactList::Interacted],
            false
        )]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("people_search"))
)]
async fn imap_contacts_rank_with_other_inbox_providers(pool: PgPool) {
    let inbox = uuid::Uuid::parse_str("00000000-0000-4000-a000-000000000002").unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP'
        WHERE
            id = $1
        "#,
        inbox,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            contact_inbox_members
        SET
            list_key = 'imap'
        WHERE
            link_id = $1
        "#,
        inbox,
    )
    .execute(&pool)
    .await
    .unwrap();
    let people = DbContactsRepository::new(pool)
        .search_listed_people(mid(VIEWER), "sam", limit(50))
        .await
        .unwrap();
    assert_eq!(
        people
            .iter()
            .map(|person| person.contact.user_id.email_str())
            .collect::<Vec<_>>(),
        [
            "t@example.com",
            "a@example.com",
            "g@example.com",
            "n@example.com",
            "d@example.com",
            "sam.o@example.org",
            "samuel.e@example.org"
        ]
    );
    assert_eq!(people[5].contact.lists, [ContactList::Imap]);
}
