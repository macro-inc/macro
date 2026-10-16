use std::sync::Arc;

use chrono::{Duration, TimeZone, Utc};
use filter_ast::Expr;
use item_filters::{
    CallStatus,
    ast::{LiteralTree, call::CallLiteral},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::imports::{ImportedCall, ImportedCallRepository};
use crate::domain::models::CallRecordPage;
use crate::domain::ports::CallRepository;
use crate::domain::records::*;
use crate::outbound::pg_call_repo::PgCallRepo;
use crate::outbound::pg_imported_call_repo::PgImportedCallRepository;

const LATEST_FIRST: CallRecordPage = CallRecordPage {
    by_start: false,
    after: None,
};

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}

fn granola_meeting(owner: &str) -> ImportedCall {
    let attendee = macro_uuid::generate_uuid_v7();
    let started_at = Utc.with_ymd_and_hms(2026, 10, 15, 18, 54, 0).unwrap();
    ImportedCall {
        title: Some("Design review".into()),
        started_at: Some(started_at),
        ended_at: Some(started_at + Duration::minutes(3)),
        participants: vec![CallParticipant {
            id: attendee,
            user_id: None,
            display_name: Some("Ada".into()),
            email: Some("ada@example.com".into()),
            phone: None,
            external_id: None,
            attendance: vec![],
        }],
        transcript: Some(CallTranscript {
            id: macro_uuid::generate_uuid_v7(),
            recording_id: None,
            language: None,
            provider: Some(CallProvider::Granola),
            started_at: Some(started_at),
            segments: vec![
                CallTranscriptSegment {
                    sequence_num: 0,
                    participant_id: None,
                    speaker_label: Some("Ada".into()),
                    content: "Ship it".into(),
                    start_ms: Some(0),
                    end_ms: Some(1_000),
                },
                CallTranscriptSegment {
                    sequence_num: 1,
                    participant_id: None,
                    speaker_label: Some("Someone else".into()),
                    content: "Agreed".into(),
                    start_ms: Some(2_000),
                    end_ms: None,
                },
            ],
        }),
        source: CallSource {
            user_id: user(owner),
            namespace: "account".into(),
            provider: CallProvider::Granola,
            object_type: "note".into(),
            external_id: "not_123456789abcde".to_owned().try_into().unwrap(),
            external_url: Some("https://notes.granola.ai/d/abc".into()),
            external_updated_at: Some(started_at),
            synced_at: None,
            metadata: serde_json::from_value(json!({"summary": "We shipped it"})).unwrap(),
        },
    }
}

fn status_filter(status: CallStatus) -> LiteralTree<CallLiteral> {
    Some(Arc::new(Expr::Literal(CallLiteral::Status(status))))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("import_users"))
)]
async fn imported_calls_are_listed_for_their_owner(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let call_id = PgImportedCallRepository::new(pool.clone())
        .upsert(granola_meeting("import-a"))
        .await?;
    let repo = PgCallRepo::new(pool);

    let records = repo
        .get_call_records_by_user(user("import-a").copied(), 10, &None, LATEST_FIRST)
        .await?;
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.call_id, call_id);
    assert_eq!(record.custom_name.as_deref(), Some("Design review"));
    assert_eq!(record.summary.as_deref(), Some("We shipped it"));
    assert_eq!(record.status, Some(CallStatus::Attended));
    assert_eq!(record.room_name, None);
    assert!(!record.is_active);
    assert_eq!(record.duration_ms, Some(180_000));
    assert_eq!(record.guests.len(), 1);
    assert_eq!(record.guests[0].display_name, "Ada");

    let unattended = repo
        .get_call_records_by_user(
            user("import-a").copied(),
            10,
            &status_filter(CallStatus::Unattended),
            LATEST_FIRST,
        )
        .await?;
    assert!(unattended.is_empty());

    let others = repo
        .get_call_records_by_user(user("import-b").copied(), 10, &None, LATEST_FIRST)
        .await?;
    assert!(others.is_empty(), "imports are private to their owner");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("import_users"))
)]
async fn imported_call_record_reads_source_and_transcript(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let call_id = PgImportedCallRepository::new(pool.clone())
        .upsert(granola_meeting("import-a"))
        .await?;
    let repo = PgCallRepo::new(pool);

    let record = repo
        .get_call_record_by_call_id(&call_id)
        .await?
        .expect("imported call should be readable");
    assert_eq!(record.created_by, "macro|import-a@test.com");
    assert_eq!(record.channel_id, None);
    let source = record.source.expect("imported calls carry their source");
    assert_eq!(source.provider, "granola");
    assert_eq!(
        source.external_url.as_deref(),
        Some("https://notes.granola.ai/d/abc")
    );
    let guest_id = record.guests[0].id.to_string();
    assert_eq!(record.transcript.len(), 2);
    assert_eq!(
        record.transcript[0].speaker_id, guest_id,
        "label matches attendee"
    );
    assert_eq!(record.transcript[1].speaker_id, "Someone else");
    assert_eq!(
        record.transcript[1].started_at - record.transcript[0].started_at,
        Duration::seconds(2)
    );
    assert_ne!(
        record.transcript[0].transcript_id,
        record.transcript[1].transcript_id
    );

    assert!(
        repo.get_call_record_by_call_id(&Uuid::nil())
            .await?
            .is_none()
    );
    Ok(())
}
