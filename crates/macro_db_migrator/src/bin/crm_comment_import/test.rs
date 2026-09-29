use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;
use serde_json::{Value, json};
use sqlx::PgPool;

const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";

struct Crm {
    company: Uuid,
    contact: Uuid,
}

async fn user(pool: &PgPool, id: &str) {
    let macro_user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
    )
    .bind(macro_user)
    .bind(id)
    .bind(format!("stripe_{macro_user}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user)
        .execute(pool)
        .await
        .unwrap();
}

async fn crm(pool: &PgPool) -> Crm {
    user(pool, OWNER).await;
    user(pool, MEMBER).await;
    let team = Uuid::now_v7();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'team', $2)")
        .bind(team)
        .bind(OWNER)
        .execute(pool)
        .await
        .unwrap();
    let company = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction)
         VALUES ($1, $2, true, now(), now())",
    )
    .bind(company)
    .bind(team)
    .execute(pool)
    .await
    .unwrap();
    let contact = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
         VALUES ($1, $2, 'ada@example.com', now(), now())",
    )
    .bind(contact)
    .bind(company)
    .execute(pool)
    .await
    .unwrap();
    Crm { company, contact }
}

enum Record {
    Company(Uuid),
    Contact(Uuid),
}

async fn thread(pool: &PgPool, record: Record, owner: &str, resolved: bool) -> Uuid {
    let (company, contact) = match record {
        Record::Company(id) => (Some(id), None),
        Record::Contact(id) => (None, Some(id)),
    };
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_thread (id, company_id, contact_id, owner, resolved, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '3 hours', now() - interval '3 hours')",
    )
    .bind(id)
    .bind(company)
    .bind(contact)
    .bind(owner)
    .bind(resolved)
    .execute(pool)
    .await
    .unwrap();
    id
}

/// A comment created `hours_ago`, last updated `updated_hours_ago`.
async fn comment(
    pool: &PgPool,
    thread: Uuid,
    owner: &str,
    text: &str,
    hours_ago: i32,
    updated_hours_ago: i32,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_comment (id, thread_id, owner, sender, text, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $4,
                 now() - make_interval(hours => $5), now() - make_interval(hours => $6))",
    )
    .bind(id)
    .bind(thread)
    .bind(owner)
    .bind(text)
    .bind(hours_ago)
    .bind(updated_hours_ago)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[derive(Debug, PartialEq)]
struct Stored {
    parent: (String, String),
    thread_id: Option<Uuid>,
    sender: String,
    content: String,
    edited: bool,
    deleted: bool,
    import_metadata: Option<Value>,
}

async fn message(pool: &PgPool, id: Uuid) -> Stored {
    let row: (
        String,
        String,
        Option<Uuid>,
        String,
        String,
        bool,
        bool,
        Option<Value>,
    ) = sqlx::query_as(
        "SELECT parent_entity_type, parent_entity_id, thread_id, sender_id, content,
                edited_at IS NOT NULL, deleted_at IS NOT NULL, import_metadata
         FROM comms_messages WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    Stored {
        parent: (row.0, row.1),
        thread_id: row.2,
        sender: row.3,
        content: row.4,
        edited: row.5,
        deleted: row.6,
        import_metadata: row.7,
    }
}

#[derive(Debug, PartialEq)]
struct StoredThread {
    parent: (String, String),
    user_id: String,
    resolved: bool,
    deleted: bool,
}

async fn stored_thread(pool: &PgPool, root: Uuid) -> Option<StoredThread> {
    sqlx::query_as::<_, (String, String, String, bool, bool)>(
        "SELECT parent_entity_type, parent_entity_id, user_id, resolved, deleted_at IS NOT NULL
         FROM comms_message_threads WHERE root_id = $1",
    )
    .bind(root)
    .fetch_optional(pool)
    .await
    .unwrap()
    .map(|row| StoredThread {
        parent: (row.0, row.1),
        user_id: row.2,
        resolved: row.3,
        deleted: row.4,
    })
}

async fn message_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM comms_messages")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_threads_become_discussions_keyed_by_their_first_comment(pool: PgPool) {
    let crm = crm(&pool).await;
    let company_thread = thread(&pool, Record::Company(crm.company), OWNER, true).await;
    let root = comment(&pool, company_thread, OWNER, "root", 3, 3).await;
    let edited_reply = comment(&pool, company_thread, MEMBER, "edited reply", 2, 1).await;
    let contact_thread = thread(&pool, Record::Contact(crm.contact), MEMBER, false).await;
    let contact_root = comment(&pool, contact_thread, MEMBER, "on the contact", 2, 2).await;
    let deleted_reply = comment(&pool, contact_thread, OWNER, "gone", 1, 1).await;
    sqlx::query("UPDATE crm_comment SET deleted_at = now() WHERE id = $1")
        .bind(deleted_reply)
        .execute(&pool)
        .await
        .unwrap();

    let mut connection = pool.acquire().await.unwrap();
    let report = run(&mut connection).await.unwrap();

    assert_eq!(report.blockers, Blockers::default());
    assert_eq!(report.invariants, Invariants::default());
    assert_eq!(report.pending_comments, 4);
    assert_eq!((report.messages_inserted, report.messages_updated), (4, 0));
    assert_eq!(report.threads_written, 2);

    let company = ("crm_company".to_owned(), crm.company.to_string());
    let contact = ("crm_contact".to_owned(), crm.contact.to_string());
    assert_eq!(
        message(&pool, root).await,
        Stored {
            parent: company.clone(),
            thread_id: None,
            sender: OWNER.to_owned(),
            content: "root".to_owned(),
            edited: false,
            deleted: false,
            import_metadata: Some(
                json!({"source": "crm_comment", "legacy_thread_id": company_thread})
            ),
        }
    );
    assert_eq!(
        message(&pool, edited_reply).await,
        Stored {
            parent: company.clone(),
            thread_id: Some(root),
            sender: MEMBER.to_owned(),
            content: "edited reply".to_owned(),
            edited: true,
            deleted: false,
            import_metadata: Some(
                json!({"source": "crm_comment", "legacy_thread_id": company_thread})
            ),
        }
    );
    assert_eq!(message(&pool, contact_root).await.parent, contact);
    let deleted = message(&pool, deleted_reply).await;
    assert_eq!(
        (deleted.thread_id, deleted.deleted),
        (Some(contact_root), true)
    );

    assert_eq!(
        stored_thread(&pool, root).await,
        Some(StoredThread {
            parent: company,
            user_id: OWNER.to_owned(),
            resolved: true,
            deleted: false,
        })
    );
    assert_eq!(
        stored_thread(&pool, contact_root).await,
        Some(StoredThread {
            parent: contact,
            user_id: MEMBER.to_owned(),
            resolved: false,
            deleted: false,
        })
    );
    assert_eq!(stored_thread(&pool, edited_reply).await, None);

    let rerun = run(&mut connection).await.unwrap();
    assert_eq!(
        (rerun.pending_comments, rerun.stale_comments),
        (0, 0),
        "{rerun}"
    );
    assert_eq!(
        (
            rerun.messages_inserted,
            rerun.messages_updated,
            rerun.threads_written
        ),
        (0, 0, 0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_legacy_thread_deletes_every_message(pool: PgPool) {
    let crm = crm(&pool).await;
    let legacy = thread(&pool, Record::Company(crm.company), OWNER, false).await;
    let root = comment(&pool, legacy, OWNER, "root", 2, 2).await;
    let reply = comment(&pool, legacy, OWNER, "reply", 1, 1).await;
    sqlx::query("UPDATE crm_thread SET deleted_at = now() WHERE id = $1")
        .bind(legacy)
        .execute(&pool)
        .await
        .unwrap();

    let mut connection = pool.acquire().await.unwrap();
    run(&mut connection).await.unwrap();

    assert!(message(&pool, root).await.deleted);
    assert!(message(&pool, reply).await.deleted);
    assert!(stored_thread(&pool, root).await.unwrap().deleted);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn newer_legacy_rows_update_and_newer_store_rows_win(pool: PgPool) {
    let crm = crm(&pool).await;
    let legacy = thread(&pool, Record::Company(crm.company), OWNER, false).await;
    let root = comment(&pool, legacy, OWNER, "root", 2, 2).await;
    let reply = comment(&pool, legacy, OWNER, "reply", 1, 1).await;
    let mut connection = pool.acquire().await.unwrap();
    run(&mut connection).await.unwrap();

    sqlx::query("UPDATE crm_comment SET text = 'edited in legacy' WHERE id = $1")
        .bind(root)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE crm_thread SET resolved = true WHERE id = $1")
        .bind(legacy)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE comms_messages SET content = 'edited in store', updated_at = now() + interval '1 hour'
         WHERE id = $1",
    )
    .bind(reply)
    .execute(&pool)
    .await
    .unwrap();

    let check = check(&mut connection).await.unwrap();
    assert_eq!(check.stale_comments, 1);
    assert_eq!(check.invariants.content_mismatches, 1);

    let report = run(&mut connection).await.unwrap();
    assert_eq!((report.messages_inserted, report.messages_updated), (0, 1));
    assert_eq!(report.threads_written, 1);
    assert_eq!(report.invariants, Invariants::default());
    let root = message(&pool, root).await;
    assert_eq!(
        (root.content.as_str(), root.edited),
        ("edited in legacy", true)
    );
    assert_eq!(message(&pool, reply).await.content, "edited in store");
    assert!(
        stored_thread(&pool, root_id(&pool, legacy).await)
            .await
            .unwrap()
            .resolved
    );
}

async fn root_id(pool: &PgPool, legacy_thread: Uuid) -> Uuid {
    sqlx::query_scalar(
        "SELECT root_id FROM comms_message_threads
         WHERE import_metadata->>'legacy_thread_id' = $1::text",
    )
    .bind(legacy_thread)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unrepresentable_legacy_rows_block_the_whole_import(pool: PgPool) {
    let crm = crm(&pool).await;
    let legacy = thread(&pool, Record::Company(crm.company), OWNER, false).await;
    comment(&pool, legacy, OWNER, "fine", 2, 2).await;
    let foreign = comment(&pool, legacy, OWNER, "sent for someone", 1, 1).await;
    sqlx::query("UPDATE crm_comment SET sender = $2 WHERE id = $1")
        .bind(foreign)
        .bind(MEMBER)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE crm_thread SET metadata = '{}' WHERE id = $1")
        .bind(legacy)
        .execute(&pool)
        .await
        .unwrap();

    let mut connection = pool.acquire().await.unwrap();
    let error = run(&mut connection).await.unwrap_err();

    assert!(error.to_string().contains("preflight blocked"), "{error}");
    assert_eq!(message_count(&pool).await, 0);
    let report = check(&mut connection).await.unwrap();
    assert_eq!(
        report.blockers,
        Blockers {
            metadata: 1,
            foreign_senders: 1,
            explicit_order: 0,
            id_collisions: 0,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_comment_id_used_by_another_message_blocks_the_import(pool: PgPool) {
    let crm = crm(&pool).await;
    let legacy = thread(&pool, Record::Company(crm.company), OWNER, false).await;
    let id = comment(&pool, legacy, OWNER, "legacy", 1, 1).await;
    sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'crm_company', $2, $3, 'posted through the store')",
    )
    .bind(id)
    .bind(crm.company.to_string())
    .bind(OWNER)
    .execute(&pool)
    .await
    .unwrap();

    let mut connection = pool.acquire().await.unwrap();
    assert!(run(&mut connection).await.is_err());

    assert_eq!(
        check(&mut connection).await.unwrap().blockers.id_collisions,
        1
    );
    assert_eq!(message(&pool, id).await.content, "posted through the store");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn check_writes_nothing_and_empty_threads_are_skipped(pool: PgPool) {
    let crm = crm(&pool).await;
    thread(&pool, Record::Company(crm.company), OWNER, false).await;
    let legacy = thread(&pool, Record::Contact(crm.contact), OWNER, false).await;
    comment(&pool, legacy, OWNER, "only comment", 1, 1).await;

    let mut connection = pool.acquire().await.unwrap();
    let report = check(&mut connection).await.unwrap();
    assert_eq!((report.pending_comments, report.empty_threads), (1, 1));
    assert_eq!(report.invariants.missing_messages, 1);
    assert_eq!(message_count(&pool).await, 0);

    let report = run(&mut connection).await.unwrap();
    assert_eq!(report.threads_written, 1);
    let threads: i64 = sqlx::query_scalar("SELECT count(*) FROM comms_message_threads")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(threads, 1);
}
