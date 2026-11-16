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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("import_users"))
)]
async fn source_records_list_one_providers_calls_for_their_owner_latest_first(pool: PgPool) {
    let service = CallImportServiceImpl(
        PgImportedCallRepository::new(pool),
        macro_event_broker::NoopMacroEventBroker,
    );
    let revision = "2026-11-01T12:00:00Z"
        .parse::<chrono::DateTime<Utc>>()
        .unwrap();
    let morning = "2026-11-02T09:00:00Z"
        .parse::<chrono::DateTime<Utc>>()
        .unwrap();
    let afternoon = "2026-11-02T15:00:00Z"
        .parse::<chrono::DateTime<Utc>>()
        .unwrap();

    let mut earlier = snapshot("import-a", revision);
    earlier.title = Some("Standup".into());
    earlier.started_at = Some(morning);
    earlier.ended_at = Some(morning + chrono::Duration::minutes(15));
    earlier.source.external_id = ExternalCallId("not_earlier".into());
    earlier.source.external_url = Some("https://notes.granola.ai/d/not_earlier".into());
    earlier.participants = vec![
        CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: Some("Grace".into()),
            email: Some("grace@example.com".into()),
            phone: None,
            external_id: None,
            attendance: vec![],
        },
        CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: None,
            email: Some("anonymous@example.com".into()),
            phone: None,
            external_id: None,
            attendance: vec![],
        },
        CallParticipant {
            id: macro_uuid::generate_uuid_v7(),
            user_id: None,
            display_name: Some("Ada".into()),
            email: Some("ada@example.com".into()),
            phone: None,
            external_id: None,
            attendance: vec![],
        },
    ];
    let earlier_id = service.ingest(earlier).await.unwrap();

    let mut later = snapshot("import-a", revision);
    later.title = Some("Planning".into());
    later.started_at = Some(afternoon);
    later.source.external_id = ExternalCallId("not_later".into());
    later.source.metadata =
        serde_json::from_value(json!({"sourceTitle":"Planning","summary":null})).unwrap();
    later.participants = vec![];
    let later_id = service.ingest(later).await.unwrap();

    let mut untimed = snapshot("import-a", revision);
    untimed.source.external_id = ExternalCallId("not_untimed".into());
    let untimed_id = service.ingest(untimed).await.unwrap();

    let mut macro_provider = snapshot("import-a", revision);
    macro_provider.source.provider = CallProvider::Macro;
    macro_provider.source.external_id = ExternalCallId("macro_call".into());
    let macro_provider_id = service.ingest(macro_provider).await.unwrap();

    let mut other_owner = snapshot("import-b", revision);
    other_owner.started_at = Some(afternoon);
    service.ingest(other_owner).await.unwrap();

    let records = service
        .list_source_records(&user("import-a"), CallProvider::Granola)
        .await
        .unwrap();
    let ids: Vec<Uuid> = records.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![later_id, earlier_id, untimed_id]);

    assert_eq!(records[0].title.as_deref(), Some("Planning"));
    assert_eq!(records[0].started_at, Some(afternoon));
    assert_eq!(records[0].ended_at, None);
    assert!(records[0].attendees.is_empty());
    assert_eq!(records[0].external_id, ExternalCallId("not_later".into()));
    assert_eq!(records[0].summary, None);

    assert_eq!(records[1].title.as_deref(), Some("Standup"));
    assert_eq!(records[1].started_at, Some(morning));
    assert_eq!(
        records[1].ended_at,
        Some(morning + chrono::Duration::minutes(15))
    );
    assert_eq!(
        records[1].attendees,
        vec!["Ada".to_string(), "Grace".to_string()]
    );
    assert_eq!(records[1].external_id, ExternalCallId("not_earlier".into()));
    assert_eq!(
        records[1].external_url.as_deref(),
        Some("https://notes.granola.ai/d/not_earlier")
    );
    assert_eq!(records[1].summary.as_deref(), Some("Ship it"));
    assert_eq!(records[1].external_updated_at, Some(revision));

    assert_eq!(records[2].started_at, None);
    assert_eq!(records[2].attendees, vec!["Guest".to_string()]);

    let macro_records = service
        .list_source_records(&user("import-a"), CallProvider::Macro)
        .await
        .unwrap();
    let macro_ids: Vec<Uuid> = macro_records.iter().map(|r| r.id).collect();
    assert_eq!(macro_ids, vec![macro_provider_id]);
}
