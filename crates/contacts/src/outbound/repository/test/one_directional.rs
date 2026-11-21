//! Legacy reads hide a peer only the peer has: the directed lists say the
//! peer has the viewer and nothing says the viewer has the peer.

use super::*;
use crate::domain::models::page::ContactPageSize;
use crate::domain::models::people::PeopleSearchLimit;
use crate::domain::models::query::ContactLookup;
use crate::domain::ports::{ContactsPageRepository, PeopleSearchRepository};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn a_page_hides_peers_only_the_peer_has(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    let page = repo
        .contact_id_page(
            mid("macro|viewer@example.com"),
            None,
            ContactPageSize::new(500).unwrap(),
        )
        .await
        .unwrap();

    let ids: Vec<_> = page
        .contacts
        .iter()
        .map(|row| row.user_id.as_ref())
        .collect();
    assert_eq!(
        ids,
        vec![
            "macro|agent@example.com",
            "macro|legacy@example.com",
            "macro|mutual@example.com",
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
async fn a_hidden_peer_does_not_end_the_page_early(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);
    let viewer = mid("macro|viewer@example.com");
    let limit = ContactPageSize::new(1).unwrap();

    // inviter sorts second: its page comes back empty but still continues.
    let mut after = None;
    let mut pages = Vec::new();
    loop {
        let page = repo
            .contact_id_page(viewer.clone(), after.as_ref(), limit)
            .await
            .unwrap();
        pages.push(
            page.contacts
                .iter()
                .map(|row| row.user_id.as_ref().to_owned())
                .collect::<Vec<_>>(),
        );
        after = page.next_cursor;
        if after.is_none() {
            break;
        }
    }

    assert_eq!(
        pages,
        vec![
            vec!["macro|agent@example.com".to_owned()],
            vec![],
            vec!["macro|legacy@example.com".to_owned()],
            vec!["macro|mutual@example.com".to_owned()],
            vec![],
            vec!["macro|teammate@example.com".to_owned()],
            vec!["macro|viewer@example.com".to_owned()],
        ]
    );
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
async fn a_lookup_hides_peers_only_the_peer_has(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);
    let lookup = ContactLookup::new(vec![
        mid("macro|owner@example.com"),
        mid("macro|inviter@example.com"),
        mid("macro|mutual@example.com"),
        mid("macro|legacy@example.com"),
        mid("macro|agent@example.com"),
        mid("macro|teammate@example.com"),
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
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("one_directional"))
)]
async fn the_full_listing_hides_peers_only_the_peer_has(pool: PgPool) {
    let repo = DbContactsRepository::new(pool);

    let mut contacts = repo
        .get_contacts(mid("macro|viewer@example.com"))
        .await
        .unwrap();
    contacts.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));

    assert_eq!(
        contacts,
        vec![
            mid("macro|agent@example.com"),
            mid("macro|legacy@example.com"),
            mid("macro|mutual@example.com"),
            mid("macro|teammate@example.com"),
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
            ("macro|teammate@example.com".to_owned(), false),
            ("macro|viewer@example.com".to_owned(), false),
        ]
    );
}
