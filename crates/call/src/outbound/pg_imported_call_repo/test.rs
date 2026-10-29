use super::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{email}@test.com"))
        .unwrap()
        .into_owned()
}
fn snapshot(owner: &str, revision: chrono::DateTime<Utc>) -> ImportedCall {
    ImportedCall {
        title: Some("Design review".into()),
        started_at: None,
        ended_at: None,
        participants: vec![CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: Some("Guest".into()),
            email: Some("guest@test.com".into()),
            phone: None,
            external_id: None,
            attendance: vec![],
        }],
        transcript: Some(CallTranscript {
            id: macro_uuid::generate_uuid_v7(),
            recording_id: None,
            language: None,
            provider: Some(CallProvider::Granola),
            started_at: None,
            segments: vec![CallTranscriptSegment {
                sequence_num: 0,
                participant_id: None,
                speaker_label: Some("Speaker A".into()),
                content: "Ship it".into(),
                start_ms: None,
                end_ms: None,
            }],
        }),
        source: CallSource {
            user_id: user(owner),
            namespace: "account".into(),
            provider: CallProvider::Granola,
            object_type: "note".into(),
            external_id: ExternalCallId("not_123456789abcde".into()),
            external_url: None,
            external_updated_at: Some(revision),
            synced_at: None,
            metadata: serde_json::from_value(
                json!({"sourceTitle":"Design review","summary":"Ship it"}),
            )
            .unwrap(),
        },
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("import_users"))
)]
async fn imports_are_private_idempotent_owner_scoped_and_revision_ordered(pool: PgPool) {
    let service = CallImportServiceImpl(
        PgImportedCallRepository::new(pool.clone()),
        macro_event_broker::NoopMacroEventBroker,
    );
    let now = Utc::now();
    let id = service.ingest(snapshot("import-a", now)).await.unwrap();
    let first = service.read(&user("import-a"), id).await.unwrap().unwrap();
    assert_eq!(first.entity.created_via, CallCreatedVia::Import);
    assert!(first.entity.started_at.is_none());
    assert!(service.read(&user("import-b"), id).await.unwrap().is_none());
    let same = service.ingest(snapshot("import-a", now)).await.unwrap();
    assert_eq!(same, id);
    let updated = service.read(&user("import-a"), id).await.unwrap().unwrap();
    assert_eq!(updated.participants[0].id, first.participants[0].id);
    assert_eq!(updated.transcripts[0].id, first.transcripts[0].id);
    assert_eq!(updated.transcripts[0].segments.len(), 1);
    let permissions = sqlx::query!(
        r#"SELECT s."linkShare"::text AS link_share, (SELECT count(*) FROM entity_access WHERE entity_id = c.id) AS grants
        FROM call_entities c JOIN "SharePermission" s ON s.id = c.share_permission_id WHERE c.id = $1"#, id
    ).fetch_one(&pool).await.unwrap();
    assert!(permissions.link_share.is_none());
    assert_eq!(permissions.grants, Some(1));
    sqlx::query!(
        "UPDATE call_entities SET title = 'My title' WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut newer = snapshot("import-a", now + chrono::Duration::seconds(1));
    newer.transcript.as_mut().unwrap().segments[0].content = "Updated".into();
    service.ingest(newer).await.unwrap();
    service.ingest(snapshot("import-a", now)).await.unwrap();
    let record = service.read(&user("import-a"), id).await.unwrap().unwrap();
    assert_eq!(record.entity.title.as_deref(), Some("My title"));
    assert_eq!(record.transcripts[0].segments[0].content, "Updated");
    let other = service.ingest(snapshot("import-b", now)).await.unwrap();
    assert_ne!(other, id);
    assert_eq!(service.list(&user("import-a")).await.unwrap().len(), 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("import_users"))
)]
async fn imports_require_a_complete_source_identity(pool: PgPool) {
    let service = CallImportServiceImpl(
        PgImportedCallRepository::new(pool),
        macro_event_broker::NoopMacroEventBroker,
    );
    let mut call = snapshot("import-a", Utc::now());
    call.source.external_id = ExternalCallId(String::new());
    assert!(service.ingest(call).await.is_err());
    let mut call = snapshot("import-a", Utc::now());
    call.source.namespace = " ".into();
    assert!(service.ingest(call).await.is_err());
}
