use chrono::{DateTime, TimeZone, Utc};
use email::outbound::EmailPgRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::outbound::pg_suggestion_repo::test::insert_user;

const OWNER: &str = "macro|waits-owner@example.com";
const SENDER: &str = "macro|waits-sender@example.com";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap()
}

fn at(hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 2, hour, 0, 0).unwrap()
}

fn waits(pool: &PgPool) -> ItemReplyWaits<EmailPgRepo> {
    ItemReplyWaits {
        email: EmailPgRepo::new(pool.clone()),
        pool: pool.clone(),
    }
}

fn target(entity_type: EntityType, entity_id: Uuid, part: Option<Uuid>) -> Target {
    Target {
        entity_type,
        entity_id: entity_id.to_string(),
        part_id: part.map(|part| part.to_string()),
    }
}

/// An inbox of the owner's with a new thread, and that thread.
async fn thread(pool: &PgPool) -> (Uuid, Uuid) {
    let (inbox, thread) = (Uuid::now_v7(), Uuid::now_v7());
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        inbox,
        OWNER,
        format!("{inbox}@example.com"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread,
        inbox,
    )
    .execute(pool)
    .await
    .unwrap();
    (inbox, thread)
}

/// A message in `thread` from a contact named `name`.
async fn email(
    pool: &PgPool,
    (inbox, thread): (Uuid, Uuid),
    name: Option<&str>,
    sent: bool,
    draft: bool,
    hour: u32,
) {
    let contact = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address, name) VALUES ($1, $2, $3, $4)",
        contact,
        inbox,
        format!("{contact}@example.com"),
        name,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_messages
             (id, thread_id, link_id, from_contact_id, is_sent, is_draft, internal_date_ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        Uuid::now_v7(),
        thread,
        inbox,
        contact,
        sent,
        draft,
        at(hour),
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_email_thread_waits_on_its_newest_message_unless_the_person_sent_it(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let waits = waits(&pool);
    let waiting = |thread: Uuid| {
        let waits = &waits;
        async move {
            waits
                .waiting(&owner(), &target(EntityType::EmailThread, thread, None))
                .await
                .unwrap()
        }
    };

    // Answered by the person, then written to again: the newest counts, and
    // the person's own draft after it doesn't.
    let asked = thread(&pool).await;
    email(&pool, asked, Some("Ada Lovelace"), false, false, 8).await;
    email(&pool, asked, None, true, false, 9).await;
    email(&pool, asked, Some("Ada Lovelace"), false, false, 10).await;
    email(&pool, asked, None, false, true, 11).await;
    assert_eq!(
        waiting(asked.1).await,
        Some(Waiting {
            since: at(10),
            from: Some("Ada Lovelace".to_owned()),
        })
    );

    let answered = thread(&pool).await;
    email(&pool, answered, Some("Ada Lovelace"), false, false, 8).await;
    email(&pool, answered, None, true, false, 9).await;
    assert_eq!(waiting(answered.1).await, None);

    // A sender named only by an address is shown by no name.
    let unnamed = thread(&pool).await;
    email(&pool, unnamed, Some("ada@example.com"), false, false, 8).await;
    assert_eq!(
        waiting(unnamed.1).await,
        Some(Waiting {
            since: at(8),
            from: None,
        })
    );

    assert_eq!(waiting(Uuid::now_v7()).await, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_message_waits_unless_the_person_sent_it(pool: PgPool) {
    for id in [OWNER, SENDER] {
        insert_user(&pool, id).await;
    }
    sqlx::query!(
        r#"INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
           SELECT macro_user_id, 'Grace', 'Hopper' FROM "User" WHERE id = $1"#,
        SENDER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    let message = |sender: &'static str, deleted: bool| {
        let pool = pool.clone();
        async move {
            let id = Uuid::now_v7();
            sqlx::query!(
                r#"INSERT INTO comms_messages
                     (id, sender_id, content, parent_entity_type, parent_entity_id, created_at,
                      deleted_at)
                   VALUES ($1, $2, 'hi', 'channel', $3, $4,
                           CASE WHEN $5 THEN now()::timestamp END)"#,
                id,
                sender,
                channel.to_string(),
                at(9),
                deleted,
            )
            .execute(&pool)
            .await
            .unwrap();
            id
        }
    };
    let asked = message(SENDER, false).await;
    let own = message(OWNER, false).await;
    let deleted = message(SENDER, true).await;
    let waits = waits(&pool);
    let waiting = |part: Option<Uuid>| {
        let waits = &waits;
        async move {
            waits
                .waiting(&owner(), &target(EntityType::Channel, channel, part))
                .await
                .unwrap()
        }
    };

    assert_eq!(
        waiting(Some(asked)).await,
        Some(Waiting {
            since: at(9),
            from: Some("Grace Hopper".to_owned()),
        })
    );
    assert_eq!(waiting(Some(own)).await, None);
    assert_eq!(waiting(Some(deleted)).await, None);
    assert_eq!(waiting(None).await, None);
}
