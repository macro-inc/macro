//! Postgres-backed repository for speaker voice embeddings.

use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::VoiceRepository;

/// Postgres adapter implementing [`VoiceRepository`].
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

    async fn upsert_voice(&self, embedding: &[f32]) -> Result<Uuid, Self::Err> {
        let vec = Vector::from(embedding.to_vec());
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO voice (embedding) VALUES ($1) RETURNING id",
        )
        .bind(vec)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    async fn link_user_voice(
        &self,
        macro_user_id: &Uuid,
        voice_id: &Uuid,
    ) -> Result<(), Self::Err> {
        sqlx::query(
            "INSERT INTO macro_user_voice (macro_user_id, voice_id) \
             VALUES ($1, $2) \
             ON CONFLICT (macro_user_id, voice_id) DO NOTHING",
        )
        .bind(macro_user_id)
        .bind(voice_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_user_voices(&self, macro_user_id: &Uuid) -> Result<Vec<Uuid>, Self::Err> {
        let rows: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT voice_id FROM macro_user_voice WHERE macro_user_id = $1",
        )
        .bind(macro_user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    async fn find_user_by_voice(&self, voice_id: &Uuid) -> Result<Option<Uuid>, Self::Err> {
        let row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT macro_user_id FROM macro_user_voice WHERE voice_id = $1 LIMIT 1",
        )
        .bind(voice_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.0))
    }

    async fn find_nearest_user(
        &self,
        embedding: &[f32],
        threshold: f32,
    ) -> Result<Option<Uuid>, Self::Err> {
        let vec = Vector::from(embedding.to_vec());
        let row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT muv.macro_user_id \
             FROM voice v \
             JOIN macro_user_voice muv ON muv.voice_id = v.id \
             WHERE (v.embedding <=> $1) <= $2 \
             ORDER BY v.embedding <=> $1 ASC \
             LIMIT 1",
        )
        .bind(vec)
        .bind(threshold)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.0))
    }
}
