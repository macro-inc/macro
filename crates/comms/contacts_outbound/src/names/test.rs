use super::*;
use crate::{gateway::ConnectionGatewayNotifier, repository::DbContactsRepository};
use contacts_core::{
    models::{
        page::ContactPageSize,
        query::{ContactLookup, ContactSearch},
    },
    ports::ContactDirectory,
    service::{ContactsDomainService, directory::ContactsDirectoryService},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Arc;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory_names"))
)]
async fn enriched_pages_preserve_profile_precedence_and_private_address_book_names(pool: PgPool) {
    let service = ContactsDirectoryService::new(
        Arc::new(ContactsDomainService {
            repository: DbContactsRepository::new(pool.clone()),
            notifier: None::<ConnectionGatewayNotifier>,
        }),
        DbContactNames::new(pool.clone()),
    );
    let first = service
        .contact_page(
            MacroUserIdStr::try_from_email("first@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    let second = service
        .contact_page(
            MacroUserIdStr::try_from_email("second@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(
        first
            .contacts
            .iter()
            .map(|c| (c.user_id.email_str(), c.name.as_deref()))
            .collect::<Vec<_>>(),
        [
            ("external@example.com", Some("First Private")),
            ("first@example.com", None),
            ("profile@example.com", Some("Profile")),
            ("unknown@example.com", None),
        ]
    );
    assert_eq!(
        second
            .contacts
            .iter()
            .map(|c| (c.user_id.email_str(), c.name.as_deref()))
            .collect::<Vec<_>>(),
        [
            ("external@example.com", Some("Second Private")),
            ("profile@example.com", Some("Profile")),
            ("second@example.com", None),
        ]
    );
    assert_ne!(first.contacts[0].id, second.contacts[0].id);
    assert!(first.next_cursor.is_none());
    assert!(second.next_cursor.is_none());
    let search = ContactSearch::new("first private").unwrap();
    let first_matches = service
        .search_contacts(
            MacroUserIdStr::try_from_email("first@example.com").unwrap(),
            &search,
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(first_matches.contacts.len(), 1);
    assert_eq!(
        first_matches.contacts[0].user_id.email_str(),
        "external@example.com"
    );
    let second_matches = service
        .search_contacts(
            MacroUserIdStr::try_from_email("second@example.com").unwrap(),
            &search,
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert!(second_matches.contacts.is_empty());
    assert!(second_matches.next_cursor.is_none());
    let lookup = ContactLookup::new(
        [
            "profile@example.com",
            "second@example.com",
            "unknown@example.com",
            "first@example.com",
        ]
        .map(|email| MacroUserIdStr::try_from_email(email).unwrap())
        .to_vec(),
    )
    .unwrap();
    let resolved = service
        .lookup_contacts(
            MacroUserIdStr::try_from_email("first@example.com").unwrap(),
            &lookup,
        )
        .await
        .unwrap();
    assert_eq!(
        resolved
            .iter()
            .map(|contact| contact.user_id.email_str())
            .collect::<Vec<_>>(),
        [
            "profile@example.com",
            "unknown@example.com",
            "first@example.com"
        ]
    );
    assert_eq!(resolved[0].id, first.contacts[2].id);
    sqlx::query!("UPDATE macro_user_info SET first_name = 'Renamed' WHERE macro_user_id = '00000000-0000-4000-8000-000000000103'")
        .execute(&pool).await.unwrap();
    let renamed = service
        .contact_page(
            MacroUserIdStr::try_from_email("first@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(renamed.contacts[2].name.as_deref(), Some("Renamed"));
    assert_eq!(renamed.contacts[2].id, first.contacts[2].id);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory_names"))
)]
async fn canonical_lookup_keeps_paged_identity_and_viewer_private_names_for_legacy_edges(
    pool: PgPool,
) {
    sqlx::query!(
        "DELETE FROM contacts_connections
         WHERE user1 IN ('macro|external@example.com', 'macro|first@example.com', 'macro|profile@example.com')
           AND user2 IN ('macro|first@example.com', 'macro|second@example.com', 'macro|profile@example.com')"
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO contacts_connections(user1, user2) VALUES
         ('macro|EXTERNAL@example.com', 'macro|first@example.com'),
         ('macro|EXTERNAL@example.com', 'macro|second@example.com'),
         ('macro|first@example.com', 'macro|profile@EXAMPLE.COM'),
         ('macro|profile@EXAMPLE.COM', 'macro|second@example.com')"
    )
    .execute(&pool)
    .await
    .unwrap();
    let service = ContactsDirectoryService::new(
        Arc::new(ContactsDomainService {
            repository: DbContactsRepository::new(pool.clone()),
            notifier: None::<ConnectionGatewayNotifier>,
        }),
        DbContactNames::new(pool),
    );
    let lookup = ContactLookup::new(
        ["external@example.com", "profile@example.com"]
            .map(|email| MacroUserIdStr::try_from_email(email).unwrap())
            .to_vec(),
    )
    .unwrap();
    let mut contact_ids = Vec::new();
    for (email, expected_name) in [
        ("first@example.com", "First Private"),
        ("second@example.com", "Second Private"),
    ] {
        let viewer = MacroUserIdStr::try_from_email(email).unwrap();
        let page = service
            .contact_page(viewer.clone(), None, ContactPageSize::DEFAULT)
            .await
            .unwrap();
        let resolved = service.lookup_contacts(viewer, &lookup).await.unwrap();
        assert_eq!(resolved.len(), 2);
        assert_eq!(resolved[0].name.as_deref(), Some(expected_name));
        assert_eq!(resolved[1].name.as_deref(), Some("Profile"));
        for contact in &resolved {
            let paged = page
                .contacts
                .iter()
                .find(|row| row.user_id == contact.user_id)
                .unwrap();
            assert_eq!(contact.id, paged.id);
            assert_eq!(contact.name, paged.name);
        }
        contact_ids.push(resolved[0].id);
    }
    assert_ne!(contact_ids[0], contact_ids[1]);
    assert!(
        service
            .lookup_contacts(
                MacroUserIdStr::try_from_email("stranger@example.com").unwrap(),
                &lookup
            )
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn name_reads_are_bounded_and_empty_batches_are_valid(pool: PgPool) {
    let reader = DbContactNames::new(pool);
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    assert!(
        reader
            .contact_names(viewer.clone(), &[])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        reader
            .contact_names(viewer.clone(), &vec![viewer; 501])
            .await
            .is_err()
    );
}
