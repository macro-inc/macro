//! Postgres-backed repository for speaker voice embeddings.

#[cfg(test)]
mod test;

use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::ports::VoiceRepository;

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

    async fn upsert_voice(&self, embedding: &[f32]) -> Result<Uuid, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();
        let vec = Vector::from(embedding.to_vec());
        let row = sqlx::query!(
            r#"
            INSERT INTO voice (id, embedding) VALUES ($1, $2) RETURNING id
            "#,
            id,
            vec as Vector,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
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
