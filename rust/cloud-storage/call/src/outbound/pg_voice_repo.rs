//! Postgres-backed repository for speaker voice embeddings.

#[cfg(test)]
mod test;

use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::VoiceRepository;

/// Cosine-distance cutoff for treating two embeddings as the same voice.
///
/// This keeps transcript ingestion from creating a fresh `voice.id` for every
/// finalized utterance from the same speaker while still allowing clearly
/// different speakers to get separate ids.
const VOICE_DEDUP_DISTANCE_THRESHOLD: f64 = 0.25;

fn embedding_advisory_lock_key(embedding: &[f32]) -> i64 {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for value in embedding {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    }

    hash as i64
}

/// Postgres adapter implementing [`VoiceRepository`].
#[derive(Clone)]
pub struct PgVoiceRepo {
    pool: PgPool,
}

impl PgVoiceRepo {
    /// Construct a new repository wrapping the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl VoiceRepository for PgVoiceRepo {
    type Err = sqlx::Error;

    #[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
    async fn upsert_voice(&self, embedding: &[f32]) -> Result<Uuid, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();
        let lock_key = embedding_advisory_lock_key(embedding);
        let vec = Vector::from(embedding.to_vec());
        let mut tx = self.pool.begin().await?;

        sqlx::query("SELECT pg_advisory_xact_lock($1::bigint)")
            .bind(lock_key)
            .fetch_one(tx.as_mut())
            .await?;

        let voice_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            WITH nearest AS (
                SELECT id
                FROM voice
                WHERE (embedding <=> $1) <= $2
                ORDER BY embedding <=> $1 ASC
                LIMIT 1
            ), inserted AS (
                INSERT INTO voice (id, embedding)
                SELECT $3, $1
                WHERE NOT EXISTS (SELECT 1 FROM nearest)
                RETURNING id
            )
            SELECT id FROM nearest
            UNION ALL
            SELECT id FROM inserted
            LIMIT 1
            "#,
        )
        .bind(vec)
        .bind(VOICE_DEDUP_DISTANCE_THRESHOLD)
        .bind(id)
        .fetch_one(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(voice_id)
    }

    async fn link_user_voice(
        &self,
        macro_user_id: &Uuid,
        voice_id: &Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO macro_user_voice (macro_user_id, voice_id)
            VALUES ($1, $2)
            ON CONFLICT (macro_user_id, voice_id) DO NOTHING
            "#,
            macro_user_id,
            voice_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_user_voices(&self, macro_user_id: &Uuid) -> Result<Vec<Uuid>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT voice_id FROM macro_user_voice WHERE macro_user_id = $1
            "#,
            macro_user_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.voice_id).collect())
    }

    async fn find_user_by_voice(&self, voice_id: &Uuid) -> Result<Option<Uuid>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT macro_user_id FROM macro_user_voice WHERE voice_id = $1 LIMIT 1
            "#,
            voice_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.macro_user_id))
    }

    async fn find_nearest_user(
        &self,
        embedding: &[f32],
        threshold: f32,
    ) -> Result<Option<Uuid>, Self::Err> {
        let vec = Vector::from(embedding.to_vec());
        // f64 cast because pgvector's `<=>` returns float8; the bound
        // parameter has to match or sqlx complains about type mismatch.
        let threshold = threshold as f64;
        let row = sqlx::query!(
            r#"
            SELECT muv.macro_user_id
            FROM voice v
            JOIN macro_user_voice muv ON muv.voice_id = v.id
            WHERE (v.embedding <=> $1) <= $2
            ORDER BY v.embedding <=> $1 ASC
            LIMIT 1
            "#,
            vec as Vector,
            threshold,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.macro_user_id))
    }

    async fn find_nearest_user_for_voice(
        &self,
        voice_id: &Uuid,
        threshold: f32,
    ) -> Result<Option<Uuid>, Self::Err> {
        let threshold = threshold as f64;
        // The CTE pulls the target embedding once; the main query then uses
        // it for both the WHERE threshold and the ORDER BY ranking.
        let row = sqlx::query!(
            r#"
            WITH target AS (SELECT embedding FROM voice WHERE id = $1)
            SELECT muv.macro_user_id
            FROM voice v
            JOIN macro_user_voice muv ON muv.voice_id = v.id
            WHERE (v.embedding <=> (SELECT embedding FROM target)) <= $2
            ORDER BY v.embedding <=> (SELECT embedding FROM target) ASC
            LIMIT 1
            "#,
            voice_id,
            threshold,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.macro_user_id))
    }
}
