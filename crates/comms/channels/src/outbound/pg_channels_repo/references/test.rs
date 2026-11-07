use crate::domain::models::{MessageParent, ReferenceSource, ReferenceTarget, ReferencingMessage};
use crate::outbound::pg_channels_repo::PgChannelsRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const MSG1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000001);
const MSG3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000003);
const DELETED_MSG: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);
const REPLY1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b001);
const DISCUSSION_MSG: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000d001);
const COMPANY: &str = "00000000-0000-0000-0000-00000000c0c0";
const CONTACT: &str = "00000000-0000-0000-0000-00000000c0c1";
const OTHER_CONTACT: &str = "00000000-0000-0000-0000-00000000c0c2";

fn target(entity_type: &str, entity_id: &str) -> ReferenceTarget {
    ReferenceTarget {
        entity_type: entity_type.to_owned(),
        entity_id: entity_id.to_owned(),
    }
}

async fn mention(
    pool: &Pool<Postgres>,
    source_type: &str,
    source_id: &str,
    entity_type: &str,
    entity_id: &str,
) {
    sqlx::query!(
        r#"INSERT INTO comms_entity_mentions
            (id, source_entity_type, source_entity_id, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, $5)"#,
        Uuid::now_v7(),
        source_type,
        source_id,
        entity_type,
        entity_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("channels_repo"))
)]
async fn resolves_live_documents_and_messages_once(pool: Pool<Postgres>) {
    sqlx::query!(
        r#"INSERT INTO comms_messages
            (id, parent_entity_type, parent_entity_id, sender_id, content)
           VALUES ($1, 'document', 'doc-with-discussion', 'macro|user-a@test.com', 'discussion')"#,
        DISCUSSION_MSG,
    )
    .execute(&pool)
    .await
    .unwrap();
    // A document referencing both targets, twice, is one source.
    mention(&pool, "document", "doc-1", "crm_company", COMPANY).await;
    mention(&pool, "document", "doc-1", "crm_contact", CONTACT).await;
    mention(&pool, "document", "doc-1", "crm_contact", CONTACT).await;
    // A top-level message, a reply, and a document discussion message.
    mention(&pool, "message", &MSG3.to_string(), "crm_contact", CONTACT).await;
    mention(
        &pool,
        "message",
        &REPLY1.to_string(),
        "crm_company",
        COMPANY,
    )
    .await;
    mention(
        &pool,
        "message",
        &DISCUSSION_MSG.to_string(),
        "crm_company",
        COMPANY,
    )
    .await;
    // Deleted messages, other targets, and other source types never match.
    mention(
        &pool,
        "message",
        &DELETED_MSG.to_string(),
        "crm_company",
        COMPANY,
    )
    .await;
    mention(&pool, "document", "doc-2", "crm_contact", OTHER_CONTACT).await;
    mention(&pool, "document", "doc-3", "document", COMPANY).await;
    mention(&pool, "chat", "chat-1", "crm_company", COMPANY).await;
    // An attachment of the company on a message counts as a reference.
    sqlx::query!(
        r#"INSERT INTO comms_attachments (id, message_id, entity_type, entity_id)
           VALUES ($1, $2, 'crm_company', $3)"#,
        Uuid::now_v7(),
        MSG1,
        COMPANY,
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut sources = PgChannelsRepo::new(pool)
        .query_reference_sources(&[
            target("crm_company", COMPANY),
            target("crm_contact", CONTACT),
        ])
        .await
        .unwrap();
    sources.sort_by_key(|source| format!("{source:?}"));

    let message = |message_id, thread_id, parent| {
        ReferenceSource::Message(ReferencingMessage {
            message_id,
            thread_id,
            parent,
        })
    };
    let mut expected = vec![
        ReferenceSource::Document("doc-1".to_owned()),
        message(MSG1, None, MessageParent::Channel(CH1)),
        message(MSG3, None, MessageParent::Channel(CH1)),
        message(REPLY1, Some(MSG1), MessageParent::Channel(CH1)),
        message(
            DISCUSSION_MSG,
            None,
            MessageParent::Document("doc-with-discussion".to_owned()),
        ),
    ];
    expected.sort_by_key(|source| format!("{source:?}"));
    assert_eq!(sources, expected);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_targets_reads_nothing(pool: Pool<Postgres>) {
    assert!(
        PgChannelsRepo::new(pool)
            .query_reference_sources(&[])
            .await
            .unwrap()
            .is_empty()
    );
}
