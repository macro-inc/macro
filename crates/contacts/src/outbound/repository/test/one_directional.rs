//! Legacy reads hide a peer only the peer has: the directed lists say the
//! peer has the viewer and nothing says the viewer has the peer. Teammates
//! come from the live roster, with or without an edge.

use super::*;
use crate::domain::models::page::ContactPageSize;
use crate::domain::models::people::PeopleSearchLimit;
use crate::domain::models::query::ContactLookup;
use crate::domain::ports::{ContactsPageRepository, PeopleSearchRepository};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn a_page_hides_peers_only_the_peer_has_and_lists_the_team(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    let page = repo
        .contact_id_page(
            mid("macro|viewer@example.com"),
            None,
            ContactPageSize::new(500).unwrap(),
        )
        .await
        .unwrap();

    let mut ids: Vec<_> = page
        .contacts
        .iter()
        .map(|row| row.user_id.as_ref())
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "macro|agent@example.com",
            "macro|legacy@example.com",
            "macro|mutual@example.com",
            "macro|roster@example.com",
            "macro|rz@example.com",
            "macro|teammate@example.com",
            "macro|viewer@example.com",
        ]
    );
    assert!(page.next_cursor.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn pages_of_one_walk_edges_and_roster_in_one_order(pool: PgPool) {
    // The roster's ids are folded and the edges' are raw, so both must sort
    // in the same collation as the cursor, or a page of one would skip or
    // repeat someone. Hidden peers come back as empty pages that continue.
    let repo = DbContactsRepository::new(pool);
    let viewer = mid("macro|viewer@example.com");
    let whole = repo
        .contact_id_page(viewer.clone(), None, ContactPageSize::new(500).unwrap())
        .await
        .unwrap();

    let mut after = None;
    let mut walked = Vec::new();
    let mut empty_pages = 0;
    loop {
        let page = repo
            .contact_id_page(
                viewer.clone(),
                after.as_ref(),
                ContactPageSize::new(1).unwrap(),
            )
            .await
            .unwrap();
        if page.contacts.is_empty() {
            empty_pages += 1;
        }
        walked.extend(page.contacts);
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
    }

    assert_eq!(walked, whole.contacts);
    assert_eq!(empty_pages, 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn the_peer_who_has_the_viewer_still_sees_them(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    for peer in ["macro|owner@example.com", "macro|inviter@example.com"] {
        let page = repo
            .contact_id_page(mid(peer), None, ContactPageSize::new(500).unwrap())
            .await
            .unwrap();
        let ids: Vec<_> = page
            .contacts
            .iter()
            .map(|row| row.user_id.as_ref())
            .collect();
        assert!(ids.contains(&"macro|viewer@example.com"), "{peer}: {ids:?}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn a_lookup_hides_peers_only_the_peer_has_and_finds_the_team(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);
    let lookup = ContactLookup::new(vec![
        mid("macro|owner@example.com"),
        mid("macro|inviter@example.com"),
        mid("macro|mutual@example.com"),
        mid("macro|legacy@example.com"),
        mid("macro|agent@example.com"),
        mid("macro|teammate@example.com"),
        mid("macro|roster@example.com"),
    ])
    .unwrap();

    let found = repo
        .lookup_contact_ids(mid("macro|viewer@example.com"), &lookup)
        .await
        .unwrap();

    assert_eq!(
        found,
        vec![
            mid("macro|mutual@example.com"),
            mid("macro|legacy@example.com"),
            mid("macro|agent@example.com"),
            mid("macro|teammate@example.com"),
            mid("macro|roster@example.com"),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn the_full_listing_hides_peers_only_the_peer_has_and_lists_the_team(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    let mut contacts: Vec<_> = repo
        .get_contacts(mid("macro|viewer@example.com"))
        .await
        .unwrap()
        .into_iter()
        .map(|id| id.as_ref().to_lowercase())
        .collect();
    contacts.sort();

    assert_eq!(
        contacts,
        vec![
            "macro|agent@example.com",
            "macro|legacy@example.com",
            "macro|mutual@example.com",
            "macro|roster@example.com",
            "macro|rz@example.com",
            "macro|teammate@example.com",
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn search_hides_peers_only_the_peer_has_and_keeps_the_team_agent(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    let mut found: Vec<_> = repo
        .search_people(
            mid("macro|viewer@example.com"),
            "example",
            PeopleSearchLimit::new(50).unwrap(),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|person| (person.contact.user_id.to_string(), person.is_agent))
        .collect();
    found.sort();

    assert_eq!(
        found,
        vec![
            ("macro|agent@example.com".to_owned(), true),
            ("macro|legacy@example.com".to_owned(), false),
            ("macro|mutual@example.com".to_owned(), false),
            ("macro|roster@example.com".to_owned(), false),
            ("macro|rz@example.com".to_owned(), false),
            ("macro|teammate@example.com".to_owned(), false),
            ("macro|viewer@example.com".to_owned(), false),
        ]
    );
}
