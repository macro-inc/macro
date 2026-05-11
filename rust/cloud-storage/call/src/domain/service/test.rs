use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;

use super::{exclude_voip_recipients, extract_recording_key};

#[cfg(feature = "outbound")]
use macro_db_migrator::MACRO_DB_MIGRATIONS;
#[cfg(feature = "outbound")]
use uuid::Uuid;

fn user(email: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[cfg(feature = "outbound")]
const CALL1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca110);
#[cfg(feature = "outbound")]
const MACRO_USER_A: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaa1);
#[cfg(feature = "outbound")]
const MACRO_USER_B: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbb2);

#[cfg(feature = "outbound")]
fn axis_unit_vector(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0_f32; 256];
    v[axis] = 1.0;
    v
}

#[cfg(feature = "outbound")]
async fn insert_voice(
    pool: &sqlx::Pool<sqlx::Postgres>,
    voice_id: Uuid,
    axis: usize,
) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO voice (id, embedding) VALUES ($1, $2)")
        .bind(voice_id)
        .bind(pgvector::Vector::from(axis_unit_vector(axis)))
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(feature = "outbound")]
async fn insert_user_mapping(
    pool: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserIdStr<'_>,
    macro_user_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(macro_user_id)
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET macro_user_id = EXCLUDED.macro_user_id
        "#,
    )
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

#[test]
fn extract_key_from_full_s3_url() {
    let url = "https://macro-call-recording-prod.s3.amazonaws.com/calls/0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4";
    assert_eq!(
        extract_recording_key(url),
        "0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4"
    );
}

#[test]
fn extract_key_fallback_when_no_calls_prefix() {
    let url = "s3://bucket/some/other/path.mp4";
    assert_eq!(extract_recording_key(url), url);
}

#[test]
fn extract_key_from_bare_calls_path() {
    let url = "calls/abc-123/recording.mp4";
    assert_eq!(extract_recording_key(url), "abc-123/recording.mp4");
}

#[test]
fn exclude_voip_recipients_keeps_users_without_voip_delivery() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert_eq!(filtered, HashSet::from([bob]));
}

#[test]
fn exclude_voip_recipients_returns_empty_when_all_users_received_voip() {
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    let recipients = HashSet::from([alice.clone(), bob.clone()]);
    let voip_recipients = HashSet::from([alice, bob]);

    let filtered = exclude_voip_recipients(recipients, &voip_recipients);

    assert!(filtered.is_empty());
}

#[cfg(feature = "outbound")]
#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn enroll_stable_speaker_voices_links_only_unambiguous_speakers(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    use crate::domain::models::TranscriptSegmentRequest;
    use crate::domain::ports::{CallRepository as _, VoiceRepository as _};
    use crate::outbound::{pg_call_repo::PgCallRepo, pg_voice_repo::PgVoiceRepo};
    use chrono::{Duration, Utc};

    let call_repo = PgCallRepo::new(pool.clone());
    let voice_repo = PgVoiceRepo::new(pool.clone());
    let user_a = MacroUserIdStr::parse_from_str("macro|user-a@test.com")?;
    let user_b = MacroUserIdStr::parse_from_str("macro|user-b@test.com")?;
    let voice_a = macro_uuid::generate_uuid_v7();
    let voice_b = macro_uuid::generate_uuid_v7();
    let now = Utc::now();

    insert_user_mapping(&pool, &user_a, MACRO_USER_A).await?;
    insert_user_mapping(&pool, &user_b, MACRO_USER_B).await?;
    insert_voice(&pool, voice_a, 0).await?;
    insert_voice(&pool, voice_b, 1).await?;

    let segments = [
        ("stable-a-1", user_a.as_ref(), Some("spk-a0"), voice_a),
        ("stable-a-2", user_a.as_ref(), Some("spk-a1"), voice_a),
        ("ambiguous-b-1", user_b.as_ref(), Some("spk-b0"), voice_a),
        ("ambiguous-b-2", user_b.as_ref(), Some("spk-b1"), voice_b),
    ];

    for (idx, (segment_id, speaker_id, diarized_speaker_id, voice_id)) in
        segments.into_iter().enumerate()
    {
        let started_at = now + Duration::seconds(idx as i64);
        call_repo
            .create_transcript_segment(
                &CALL1,
                &TranscriptSegmentRequest {
                    segment_id: segment_id.to_string(),
                    speaker_id: speaker_id.to_string(),
                    diarized_speaker_id: diarized_speaker_id.map(str::to_string),
                    content: segment_id.to_string(),
                    started_at,
                    ended_at: Some(started_at + Duration::milliseconds(100)),
                    is_final: true,
                    stream_started_at: None,
                    embedding: None,
                },
                Some(voice_id),
            )
            .await?;
    }

    let call_record_id = call_repo.archive_call(&CALL1).await?;

    super::enroll_stable_speaker_voices_for_call_record(&call_repo, &voice_repo, call_record_id)
        .await;

    assert_eq!(
        voice_repo.get_user_voices(&MACRO_USER_A).await?,
        vec![voice_a]
    );
    assert!(voice_repo.get_user_voices(&MACRO_USER_B).await?.is_empty());
    Ok(())
}
