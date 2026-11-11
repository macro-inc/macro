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
            external_id: ExternalCallId("not_123456789abcde".into()),
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
    let source = record.source.as_ref().expect("an import names its source");
    assert_eq!(source.provider, CallProvider::Granola);
    assert_eq!(
        source.external_url.as_deref(),
        Some("https://notes.granola.ai/d/abc")
    );

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
    assert_eq!(source.provider, CallProvider::Granola);
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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("import_users"))
)]
async fn an_attendee_with_an_account_is_a_participant_not_a_guest(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let mut call = granola_meeting("import-a");
    call.participants.extend([
        CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: Some(user("import-b")),
            display_name: Some("Sam Rep".into()),
            email: Some("sam@example.com".into()),
            phone: Some("+1555011".into()),
            external_id: None,
            attendance: vec![],
        },
        CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: Some("Caller".into()),
            email: None,
            // The import port takes numbers as the provider wrote them.
            phone: Some("+1 555 010".into()),
            external_id: None,
            attendance: vec![],
        },
    ]);
    if let Some(transcript) = call.transcript.as_mut() {
        transcript.segments[1].speaker_label = Some("sam rep".into());
    }
    let call_id = PgImportedCallRepository::new(pool.clone())
        .upsert(call)
        .await?;
    let repo = PgCallRepo::new(pool);
    let attendee = user("import-b").to_string();

    let record = repo
        .get_call_record_by_call_id(&call_id)
        .await?
        .expect("imported call should be readable");
    let participants: Vec<&str> = record
        .participants
        .iter()
        .map(|p| p.user_id.as_str())
        .collect();
    assert_eq!(participants, vec![attendee.as_str()]);
    let mut guests: Vec<&str> = record
        .guests
        .iter()
        .map(|g| g.display_name.as_str())
        .collect();
    guests.sort();
    assert_eq!(guests, vec!["Ada", "Caller"]);
    assert_eq!(
        record.transcript[1].speaker_id, attendee,
        "their label names their account"
    );

    let listed = repo
        .get_call_records_by_user(user("import-a").copied(), 10, &None, LATEST_FIRST)
        .await?;
    assert_eq!(listed[0].participants.len(), 1);
    assert_eq!(listed[0].guests.len(), 2);

    // CRM linking sees only the owner's account, and the guests by email or
    // phone: an imported call is private to its owner.
    let people = repo.get_call_record_people(&call_id).await?;
    assert_eq!(people.user_ids, vec![user("import-a")]);
    let mut guests: Vec<(Option<String>, Option<String>)> = people
        .guests
        .into_iter()
        .map(|guest| (guest.email, guest.phone))
        .collect();
    guests.sort();
    assert_eq!(
        guests,
        vec![
            (None, Some("+1555010".into())),
            (Some("ada@example.com".into()), None),
        ],
        "only guests are matched to CRM records, by E.164 number"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("import_users"))
)]
async fn a_source_this_build_does_not_know_still_lists_the_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let call_id = PgImportedCallRepository::new(pool.clone())
        .upsert(granola_meeting("import-a"))
        .await?;
    // Another service may import from a provider this build predates.
    sqlx::query!(
        "UPDATE call_entity_sources SET provider = 'future' WHERE call_id = $1",
        call_id
    )
    .execute(&pool)
    .await?;

    let listed = PgCallRepo::new(pool)
        .get_call_records_by_user(user("import-a").copied(), 10, &None, LATEST_FIRST)
        .await?;
    assert_eq!(listed.len(), 1);
    assert!(listed[0].source.is_none());
    Ok(())
}
