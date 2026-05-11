use crate::domain::ports::VoiceRepository;
use crate::outbound::pg_voice_repo::PgVoiceRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::{Uuid, uuid};

const USER_A: Uuid = uuid!("11111111-1111-1111-1111-111111111111");
const USER_B: Uuid = uuid!("22222222-2222-2222-2222-222222222222");

fn repo(pool: Pool<Postgres>) -> PgVoiceRepo {
    PgVoiceRepo::new(pool)
}

/// 256-dim unit vector with `1.0` on `axis` and `0.0` elsewhere. Using
/// orthogonal axis vectors makes cosine distance trivially predictable:
/// identical → 0, orthogonal → 1.
fn axis_unit_vector(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0_f32; 256];
    v[axis] = 1.0;
    v
}

// -- upsert_voice -------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn upsert_voice_inserts_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM voice WHERE id = $1")
        .bind(voice_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn upsert_voice_returns_distinct_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let v1 = repo.upsert_voice(&axis_unit_vector(0)).await?;
    let v2 = repo.upsert_voice(&axis_unit_vector(0)).await?;
    assert_ne!(v1, v2, "each upsert generates a fresh id");
    Ok(())
}

// -- link_user_voice / get_user_voices ----------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn link_user_voice_then_get_user_voices(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &voice_id).await?;

    let voices = repo.get_user_voices(&USER_A).await?;
    assert_eq!(voices, vec![voice_id]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn link_user_voice_idempotent_on_duplicate(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &voice_id).await?;
    // Duplicate link must not error or insert a second row.
    repo.link_user_voice(&USER_A, &voice_id).await?;

    let voices = repo.get_user_voices(&USER_A).await?;
    assert_eq!(voices, vec![voice_id]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_user_voices_empty_for_user_without_links(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    assert!(repo.get_user_voices(&USER_A).await?.is_empty());
    Ok(())
}

// -- find_user_by_voice -------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_user_by_voice_resolves_linked_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_B, &voice_id).await?;

    assert_eq!(repo.find_user_by_voice(&voice_id).await?, Some(USER_B));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_user_by_voice_returns_none_for_unlinked_voice(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    assert_eq!(repo.find_user_by_voice(&voice_id).await?, None);
    Ok(())
}

// -- find_nearest_user --------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_matches_identical_embedding(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &voice_id).await?;

    // Same embedding → cosine distance 0, well under threshold.
    let match_id = repo.find_nearest_user(&axis_unit_vector(0), 0.1).await?;
    assert_eq!(match_id, Some(USER_A));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_returns_none_above_threshold(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let voice_id = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &voice_id).await?;

    // Orthogonal embedding → cosine distance 1.0, above 0.25.
    let match_id = repo.find_nearest_user(&axis_unit_vector(1), 0.25).await?;
    assert_eq!(match_id, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_picks_closest_of_multiple(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let v_a = repo.upsert_voice(&axis_unit_vector(0)).await?;
    let v_b = repo.upsert_voice(&axis_unit_vector(1)).await?;
    repo.link_user_voice(&USER_A, &v_a).await?;
    repo.link_user_voice(&USER_B, &v_b).await?;

    // Query aligned with axis-1 → user_b wins, even though user_a is also
    // enrolled.
    let match_id = repo.find_nearest_user(&axis_unit_vector(1), 0.1).await?;
    assert_eq!(match_id, Some(USER_B));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_skips_unlinked_voices(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Insert an embedding that is NOT linked to any user — the matcher
    // must ignore it even though it would be the closest row in `voice`.
    let _unlinked = repo.upsert_voice(&axis_unit_vector(0)).await?;
    // Enroll user_b with a perpendicular embedding (distance 1).
    let v_b = repo.upsert_voice(&axis_unit_vector(1)).await?;
    repo.link_user_voice(&USER_B, &v_b).await?;

    // Querying axis-0 should not return user_b at threshold 0.25, and it
    // must not "see" the unlinked closer row.
    let match_id = repo.find_nearest_user(&axis_unit_vector(0), 0.25).await?;
    assert_eq!(match_id, None);
    Ok(())
}

// -- find_nearest_user_for_voice ----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_for_voice_resolves_via_embedding_lookup(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // user_a is enrolled with axis-0 vector.
    let enrolled = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &enrolled).await?;

    // A separate voice row with the *same* embedding (the typical
    // post-archive transcript case) must resolve back to user_a via
    // similarity, not exact id match.
    let segment_voice = repo.upsert_voice(&axis_unit_vector(0)).await?;
    assert_ne!(enrolled, segment_voice);
    let match_id = repo
        .find_nearest_user_for_voice(&segment_voice, 0.1)
        .await?;
    assert_eq!(match_id, Some(USER_A));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_for_voice_returns_none_for_unknown_voice_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let missing = Uuid::nil();
    let match_id = repo.find_nearest_user_for_voice(&missing, 0.5).await?;
    assert_eq!(match_id, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("voice_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_nearest_user_for_voice_returns_none_above_threshold(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let v_a = repo.upsert_voice(&axis_unit_vector(0)).await?;
    repo.link_user_voice(&USER_A, &v_a).await?;

    // A voice perpendicular to the only enrolled user — distance 1.0.
    let orthogonal = repo.upsert_voice(&axis_unit_vector(1)).await?;
    let match_id = repo.find_nearest_user_for_voice(&orthogonal, 0.25).await?;
    assert_eq!(match_id, None);
    Ok(())
}
