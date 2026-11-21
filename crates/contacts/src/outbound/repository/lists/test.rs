use crate::domain::models::invalidation::ContactsInvalidation;
use crate::domain::models::list::{InboxProvider, InboxSource};
use crate::domain::models::messages::{ContactsMessage, DirectoryChange};
use crate::domain::ports::{ContactListRepository, ContactsNotifier, ContactsService};
use crate::domain::service::ContactsDomainService;
use crate::outbound::repository::DbContactsRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::sync::Mutex;

const FIRST_INBOX: Uuid = Uuid::from_u128(0x00000000_0000_7000_8000_000000000001);
const SECOND_INBOX: Uuid = Uuid::from_u128(0x00000000_0000_7000_8000_000000000002);

#[derive(Default)]
struct RecordingNotifier {
    invalidations: Mutex<Vec<ContactsInvalidation>>,
}

impl ContactsNotifier for RecordingNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), rootcause::Report> {
        self.invalidations.lock().unwrap().extend(invalidations);
        Ok(())
    }
}

fn mid(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_owned()).unwrap()
}

fn gmail(link_id: Uuid) -> InboxSource {
    InboxSource {
        owner: mid("macro|a@example.com"),
        link_id,
        provider: InboxProvider::Gmail,
    }
}

fn service(pool: &PgPool) -> ContactsDomainService<DbContactsRepository, RecordingNotifier> {
    ContactsDomainService {
        repository: DbContactsRepository::new(pool.clone()),
        notifier: RecordingNotifier::default(),
    }
}

/// Each invalidation as (user, sorted changed ids), sorted by user.
fn notified(
    service: &ContactsDomainService<DbContactsRepository, RecordingNotifier>,
) -> Vec<(String, Option<Vec<String>>)> {
    let mut notified: Vec<_> = service
        .notifier
        .invalidations
        .lock()
        .unwrap()
        .drain(..)
        .map(|invalidation| {
            let changed = invalidation.changed().map(|changed| {
                let mut changed: Vec<_> = changed.iter().map(|id| id.to_string()).collect();
                changed.sort();
                changed
            });
            (invalidation.user().to_string(), changed)
        })
        .collect();
    notified.sort();
    notified
}

async fn list_rows(pool: &PgPool) -> Vec<(String, String, String)> {
    sqlx::query!(
        "SELECT user_id, contact_user_id, list_key FROM contact_list_members
         ORDER BY user_id, contact_user_id, list_key"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.user_id, row.contact_user_id, row.list_key))
    .collect()
}

async fn inbox_rows(pool: &PgPool) -> Vec<(String, String, Uuid)> {
    sqlx::query!(
        "SELECT user_id, contact_user_id, link_id FROM contact_inbox_members
         ORDER BY user_id, contact_user_id, link_id"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.user_id, row.contact_user_id, row.link_id))
    .collect()
}

async fn delete_profile(pool: &PgPool, user: &str) {
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, user)
        .execute(pool)
        .await
        .unwrap();
}

fn row(user: &str, contact: &str, list: &str) -> (String, String, String) {
    (user.to_owned(), contact.to_owned(), list.to_owned())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn interactions_pair_every_user_with_every_peer_both_ways(pool: PgPool) {
    let repo = DbContactsRepository::new(pool.clone());
    let users = [mid("macro|a@example.com"), mid("macro|b@example.com")];
    let peers = [
        mid("macro|a@example.com"),
        mid("macro|b@example.com"),
        mid("macro|c@example.com"),
    ];

    let added = repo.record_interactions(&users, &peers).await.unwrap();

    assert_eq!(added.len(), 6);
    assert_eq!(
        list_rows(&pool).await,
        [
            row("macro|a@example.com", "macro|b@example.com", "interacted"),
            row("macro|a@example.com", "macro|c@example.com", "interacted"),
            row("macro|b@example.com", "macro|a@example.com", "interacted"),
            row("macro|b@example.com", "macro|c@example.com", "interacted"),
            row("macro|c@example.com", "macro|a@example.com", "interacted"),
            row("macro|c@example.com", "macro|b@example.com", "interacted"),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn repeated_interactions_add_and_notify_nothing(pool: PgPool) {
    let service = service(&pool);
    let message = || {
        ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|a@example.com")],
            peers: vec![mid("macro|b@example.com")],
        })
    };

    service.process_message(message()).await.unwrap();
    assert_eq!(
        notified(&service),
        [
            (
                "macro|a@example.com".to_owned(),
                Some(vec!["macro|b@example.com".to_owned()])
            ),
            (
                "macro|b@example.com".to_owned(),
                Some(vec!["macro|a@example.com".to_owned()])
            ),
        ]
    );

    service.process_message(message()).await.unwrap();
    assert_eq!(notified(&service), []);
    assert_eq!(list_rows(&pool).await.len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn adding_to_a_channel_notifies_only_who_gained_someone(pool: PgPool) {
    let service = service(&pool);
    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|a@example.com"), mid("macro|b@example.com")],
            peers: vec![mid("macro|a@example.com"), mid("macro|b@example.com")],
        }))
        .await
        .unwrap();
    notified(&service);

    // c joins the channel a and b already share.
    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|c@example.com")],
            peers: vec![
                mid("macro|a@example.com"),
                mid("macro|b@example.com"),
                mid("macro|c@example.com"),
            ],
        }))
        .await
        .unwrap();

    assert_eq!(
        notified(&service),
        [
            (
                "macro|a@example.com".to_owned(),
                Some(vec!["macro|c@example.com".to_owned()])
            ),
            (
                "macro|b@example.com".to_owned(),
                Some(vec!["macro|c@example.com".to_owned()])
            ),
            (
                "macro|c@example.com".to_owned(),
                Some(vec![
                    "macro|a@example.com".to_owned(),
                    "macro|b@example.com".to_owned()
                ])
            ),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("inboxes"))
)]
async fn inbox_contacts_join_only_the_owners_directory(pool: PgPool) {
    let service = service(&pool);

    service
        .process_message(ContactsMessage::Change(DirectoryChange::InboxContacts {
            inbox: gmail(FIRST_INBOX),
            contacts: vec![mid("macro|b@example.com"), mid("macro|a@example.com")],
        }))
        .await
        .unwrap();

    assert_eq!(
        inbox_rows(&pool).await,
        [(
            "macro|a@example.com".to_owned(),
            "macro|b@example.com".to_owned(),
            FIRST_INBOX
        )]
    );
    let list_key = sqlx::query_scalar!("SELECT list_key FROM contact_inbox_members")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(list_key, "gmail");
    assert_eq!(
        notified(&service),
        [(
            "macro|a@example.com".to_owned(),
            Some(vec!["macro|b@example.com".to_owned()])
        )]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("inboxes"))
)]
async fn inbox_contacts_keep_the_legacy_edge(pool: PgPool) {
    let service = service(&pool);

    service
        .process_message(ContactsMessage::Change(DirectoryChange::InboxContacts {
            inbox: gmail(FIRST_INBOX),
            contacts: vec![mid("macro|b@example.com")],
        }))
        .await
        .unwrap();

    let edges = sqlx::query!("SELECT user1, user2 FROM contacts_connections")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].user1, "macro|a@example.com");
    assert_eq!(edges[0].user2, "macro|b@example.com");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "inboxes"))
)]
async fn a_known_contact_who_gains_a_list_is_named(pool: PgPool) {
    let service = service(&pool);
    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|a@example.com")],
            peers: vec![mid("macro|b@example.com")],
        }))
        .await
        .unwrap();
    notified(&service);

    service
        .process_message(ContactsMessage::Change(DirectoryChange::InboxContacts {
            inbox: gmail(FIRST_INBOX),
            contacts: vec![mid("macro|b@example.com")],
        }))
        .await
        .unwrap();

    assert_eq!(
        notified(&service),
        [(
            "macro|a@example.com".to_owned(),
            Some(vec!["macro|b@example.com".to_owned()])
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contacts_from_a_disconnected_inbox_are_dropped(pool: PgPool) {
    let service = service(&pool);

    service
        .process_message(ContactsMessage::Change(DirectoryChange::InboxContacts {
            inbox: gmail(FIRST_INBOX),
            contacts: vec![mid("macro|b@example.com")],
        }))
        .await
        .unwrap();

    assert_eq!(inbox_rows(&pool).await, []);
    assert_eq!(notified(&service), []);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("inboxes"))
)]
async fn disconnecting_one_inbox_keeps_contacts_known_through_another(pool: PgPool) {
    let repo = DbContactsRepository::new(pool.clone());
    repo.record_inbox_contacts(
        &gmail(FIRST_INBOX),
        &[mid("macro|b@example.com"), mid("macro|c@example.com")],
    )
    .await
    .unwrap();
    repo.record_inbox_contacts(&gmail(SECOND_INBOX), &[mid("macro|c@example.com")])
        .await
        .unwrap();

    sqlx::query!("DELETE FROM email_links WHERE id = $1", FIRST_INBOX)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        inbox_rows(&pool).await,
        [(
            "macro|a@example.com".to_owned(),
            "macro|c@example.com".to_owned(),
            SECOND_INBOX
        )]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "inboxes"))
)]
async fn deleting_a_user_removes_them_everywhere_and_notifies_who_lost_them(pool: PgPool) {
    let service = service(&pool);
    let repo = &service.repository;
    repo.record_interactions(
        &[mid("macro|a@example.com"), mid("macro|b@example.com")],
        &[
            mid("macro|a@example.com"),
            mid("macro|b@example.com"),
            mid("macro|c@example.com"),
        ],
    )
    .await
    .unwrap();
    repo.record_inbox_contacts(&gmail(FIRST_INBOX), &[mid("macro|d@example.com")])
        .await
        .unwrap();
    repo.record_inbox_contacts(&gmail(SECOND_INBOX), &[mid("macro|b@example.com")])
        .await
        .unwrap();

    delete_profile(&pool, "macro|b@example.com").await;

    service
        .process_message(ContactsMessage::Change(DirectoryChange::UserDeleted {
            user: mid("macro|b@example.com"),
        }))
        .await
        .unwrap();

    assert_eq!(
        list_rows(&pool).await,
        [
            row("macro|a@example.com", "macro|c@example.com", "interacted"),
            row("macro|c@example.com", "macro|a@example.com", "interacted"),
        ]
    );
    assert_eq!(
        inbox_rows(&pool).await,
        [(
            "macro|a@example.com".to_owned(),
            "macro|d@example.com".to_owned(),
            FIRST_INBOX
        )]
    );
    assert_eq!(
        notified(&service),
        [
            ("macro|a@example.com".to_owned(), None),
            ("macro|c@example.com".to_owned(), None),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_invite_joins_only_the_inviters_directory(pool: PgPool) {
    let service = service(&pool);

    service
        .invite_contact(mid("macro|a@example.com"), mid("macro|b@example.com"))
        .await
        .unwrap();

    assert_eq!(
        list_rows(&pool).await,
        [row("macro|a@example.com", "macro|b@example.com", "invited")]
    );
    assert_eq!(
        notified(&service),
        [(
            "macro|a@example.com".to_owned(),
            Some(vec!["macro|b@example.com".to_owned()])
        )]
    );
    // The old read path still sees the referral until reads move over.
    let edges = sqlx::query!("SELECT user1, user2 FROM contacts_connections")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].user1, "macro|a@example.com");
    assert_eq!(edges[0].user2, "macro|b@example.com");

    // A retry writes nothing new but still notifies, in case the first
    // notification failed.
    service
        .invite_contact(mid("macro|a@example.com"), mid("macro|b@example.com"))
        .await
        .unwrap();
    assert_eq!(
        notified(&service),
        [(
            "macro|a@example.com".to_owned(),
            Some(vec!["macro|b@example.com".to_owned()])
        )]
    );
    assert_eq!(list_rows(&pool).await.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inviting_yourself_writes_nothing(pool: PgPool) {
    let service = service(&pool);

    service
        .invite_contact(mid("macro|a@example.com"), mid("macro|a@example.com"))
        .await
        .unwrap();

    assert_eq!(list_rows(&pool).await, []);
    assert_eq!(notified(&service), []);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn a_user_is_not_deleted_while_their_profile_exists(pool: PgPool) {
    let service = service(&pool);
    service
        .repository
        .record_interactions(&[mid("macro|a@example.com")], &[mid("macro|b@example.com")])
        .await
        .unwrap();

    let deleted = service
        .process_message(ContactsMessage::Change(DirectoryChange::UserDeleted {
            user: mid("macro|b@example.com"),
        }))
        .await;

    assert!(deleted.is_err());
    assert_eq!(list_rows(&pool).await.len(), 2);
    assert_eq!(notified(&service), []);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn an_interaction_that_arrives_after_a_deletion_adds_nobody_back(pool: PgPool) {
    let service = service(&pool);
    delete_profile(&pool, "macro|b@example.com").await;
    service
        .process_message(ContactsMessage::Change(DirectoryChange::UserDeleted {
            user: mid("macro|b@example.com"),
        }))
        .await
        .unwrap();

    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|a@example.com"), mid("macro|b@example.com")],
            peers: vec![
                mid("macro|a@example.com"),
                mid("macro|b@example.com"),
                mid("macro|c@example.com"),
            ],
        }))
        .await
        .unwrap();

    assert_eq!(
        list_rows(&pool).await,
        [
            row("macro|a@example.com", "macro|c@example.com", "interacted"),
            row("macro|c@example.com", "macro|a@example.com", "interacted"),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "legacy_user"))
)]
async fn an_interaction_with_a_legacy_cased_account_lists_its_canonical_id(pool: PgPool) {
    let service = service(&pool);

    service
        .process_message(ContactsMessage::Change(DirectoryChange::Interacted {
            users: vec![mid("macro|a@example.com")],
            peers: vec![mid("macro|e@example.com")],
        }))
        .await
        .unwrap();

    assert_eq!(
        list_rows(&pool).await,
        [
            row("macro|a@example.com", "macro|e@example.com", "interacted"),
            row("macro|e@example.com", "macro|a@example.com", "interacted"),
        ]
    );
    assert_eq!(
        notified(&service),
        [
            (
                "macro|a@example.com".to_owned(),
                Some(vec!["macro|e@example.com".to_owned()])
            ),
            (
                "macro|e@example.com".to_owned(),
                Some(vec!["macro|a@example.com".to_owned()])
            ),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "legacy_user"))
)]
async fn a_legacy_cased_account_has_a_profile(pool: PgPool) {
    let repo = DbContactsRepository::new(pool.clone());
    delete_profile(&pool, "macro|b@example.com").await;

    let missing = repo
        .missing_profiles(&[
            mid("macro|a@example.com"),
            mid("macro|b@example.com"),
            mid("macro|e@example.com"),
        ])
        .await
        .unwrap();

    assert_eq!(missing, [mid("macro|b@example.com")]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users", "legacy_user"))
)]
async fn a_legacy_cased_account_is_not_deleted_while_its_profile_exists(pool: PgPool) {
    let service = service(&pool);
    service
        .repository
        .record_interactions(&[mid("macro|a@example.com")], &[mid("macro|e@example.com")])
        .await
        .unwrap();

    let deleted = service
        .process_message(ContactsMessage::Change(DirectoryChange::UserDeleted {
            user: mid("macro|e@example.com"),
        }))
        .await;

    assert!(deleted.is_err());
    assert_eq!(list_rows(&pool).await.len(), 2);

    delete_profile(&pool, "macro|E@example.com").await;
    service
        .process_message(ContactsMessage::Change(DirectoryChange::UserDeleted {
            user: mid("macro|e@example.com"),
        }))
        .await
        .unwrap();

    assert_eq!(list_rows(&pool).await, []);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("inboxes"))
)]
async fn imap_inbox_contacts_keep_their_provider_owner_and_legacy_edge(pool: PgPool) {
    sqlx::query!(
        r#"
        UPDATE email_links
        SET provider = 'IMAP'
        WHERE id = $1
        "#,
        FIRST_INBOX,
    )
    .execute(&pool)
    .await
    .unwrap();
    let service = service(&pool);
    let message = DirectoryChange::InboxContacts {
        inbox: InboxSource {
            owner: mid("macro|a@example.com"),
            link_id: FIRST_INBOX,
            provider: InboxProvider::Imap,
        },
        contacts: vec![mid("macro|b@example.com")],
    };
    // Exercise the queue's serialized wire value as well as its domain effect.
    let wire = serde_json::to_vec(&message).unwrap();
    let received = serde_json::from_slice(&wire).unwrap();
    service.process_message(received).await.unwrap();

    let rows = sqlx::query!(
        r#"
        SELECT user_id, contact_user_id, link_id, list_key
        FROM contact_inbox_members
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, "macro|a@example.com");
    assert_eq!(rows[0].contact_user_id, "macro|b@example.com");
    assert_eq!(rows[0].link_id, FIRST_INBOX);
    assert_eq!(rows[0].list_key, "imap");
    let edges = sqlx::query!(
        r#"
        SELECT user1, user2
        FROM contacts_connections
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].user1, "macro|a@example.com");
    assert_eq!(edges[0].user2, "macro|b@example.com");

    sqlx::query!(
        r#"
        DELETE FROM email_links
        WHERE id = $1
        "#,
        FIRST_INBOX,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(inbox_rows(&pool).await.is_empty());
}
