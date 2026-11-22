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
            "macro|inboxonly@example.com",
            "macro|invitee@example.com",
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
    // The roster's ids are folded, the edges' are raw and the viewer's own
    // inbox and invited rows are C-collated, so all must sort in the same
    // collation as the cursor, or a page of one would skip or repeat someone. Hidden peers come back as empty pages that continue.
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
        mid("macro|inboxonly@example.com"),
        mid("macro|invitee@example.com"),
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
            mid("macro|inboxonly@example.com"),
            mid("macro|invitee@example.com"),
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
            "macro|inboxonly@example.com",
            "macro|invitee@example.com",
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
            ("macro|inboxonly@example.com".to_owned(), false),
            ("macro|invitee@example.com".to_owned(), false),
            ("macro|legacy@example.com".to_owned(), false),
            ("macro|mutual@example.com".to_owned(), false),
            ("macro|roster@example.com".to_owned(), false),
            ("macro|rz@example.com".to_owned(), false),
            ("macro|teammate@example.com".to_owned(), false),
            ("macro|viewer@example.com".to_owned(), false),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_former_teammate_stays_gone_after_the_other_disconnects_their_inbox(pool: PgPool) {
    // A and B are teammates with the edge a team join wrote, and B's Gmail
    // knows A. A leaves, and later B disconnects that Gmail.
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
         ('00000000-0000-4000-8000-0000000000b1', 'a', 'a@example.com', 'cus_dir_a'),
         ('00000000-0000-4000-8000-0000000000b2', 'b', 'b@example.com', 'cus_dir_b')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES
         ('macro|a@example.com', 'a@example.com', '00000000-0000-4000-8000-0000000000b1'),
         ('macro|b@example.com', 'b@example.com', '00000000-0000-4000-8000-0000000000b2')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id)
         VALUES ('00000000-0000-4000-9000-0000000000b1', 'Team', 'macro|b@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES
         ('macro|b@example.com', '00000000-0000-4000-9000-0000000000b1', 'owner'),
         ('macro|a@example.com', '00000000-0000-4000-9000-0000000000b1', 'member')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ('00000000-0000-4000-a000-0000000000b2', 'macro|b@example.com', 'fa-b', 'b@example.com', 'GMAIL')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO contact_inbox_members (user_id, contact_user_id, link_id, list_key)
         VALUES ('macro|b@example.com', 'macro|a@example.com', '00000000-0000-4000-a000-0000000000b2', 'gmail')"
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO contacts_connections (user1, user2)
         VALUES ('macro|a@example.com', 'macro|b@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = DbContactsRepository::new(pool.clone());
    let page = |viewer: &'static str| {
        let repo = &repo;
        async move {
            repo.contact_id_page(mid(viewer), None, ContactPageSize::new(500).unwrap())
                .await
                .unwrap()
                .contacts
                .into_iter()
                .map(|row| row.user_id.as_ref().to_owned())
                .collect::<Vec<_>>()
        }
    };

    // A leaves: the membership goes, then the team's edge is deleted.
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|a@example.com'")
        .execute(&pool)
        .await
        .unwrap();
    repo.delete_connections(vec![(
        mid("macro|a@example.com"),
        mid("macro|b@example.com"),
    )])
    .await
    .unwrap();

    assert_eq!(
        page("macro|a@example.com").await,
        vec!["macro|a@example.com"]
    );
    // B's own Gmail still names A, so B keeps A without the edge.
    assert_eq!(
        page("macro|b@example.com").await,
        vec!["macro|a@example.com", "macro|b@example.com"]
    );

    // B disconnects that Gmail; its inbox rows go with it.
    sqlx::query!("DELETE FROM email_links WHERE id = '00000000-0000-4000-a000-0000000000b2'")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        page("macro|a@example.com").await,
        vec!["macro|a@example.com"]
    );
    assert_eq!(
        page("macro|b@example.com").await,
        vec!["macro|b@example.com"]
    );
}
