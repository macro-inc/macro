//! Postgres storage for artifact versions (`artifact_versions`).

#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;

use crate::domain::models::{
    ArtifactPath, ArtifactVersion, ArtifactVersionSummary, Manifest, Scene, SceneId, Sha256,
    StoredFile,
};
use crate::domain::ports::{ArtifactRepository, NewVersion};

/// One entry of the `files` column, keyed by path.
#[derive(Debug, Serialize, Deserialize)]
struct FileColumn {
    sha256: String,
    size: u64,
    content_type: String,
}

/// One entry of the `scenes` column.
#[derive(Debug, Serialize, Deserialize)]
struct SceneColumn {
    id: String,
    title: String,
    path: String,
}

struct VersionRow {
    number: i32,
    files: Json<BTreeMap<String, FileColumn>>,
    scenes: Json<Vec<SceneColumn>>,
    message: Option<String>,
    created_by: String,
    created_by_agent: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<VersionRow> for ArtifactVersion {
    fn from(row: VersionRow) -> Self {
        let files = row
            .files
            .0
            .into_iter()
            .map(|(path, file)| {
                (
                    ArtifactPath(path),
                    StoredFile {
                        sha256: Sha256(file.sha256),
                        size: file.size,
                        content_type: file.content_type,
                    },
                )
            })
            .collect();
        let scenes = row
            .scenes
            .0
            .into_iter()
            .map(|scene| Scene {
                id: SceneId(scene.id),
                title: scene.title,
                path: ArtifactPath(scene.path),
            })
            .collect();

        ArtifactVersion {
            number: row.number,
            manifest: Manifest { files, scenes },
            message: row.message,
            created_by: row.created_by,
            created_by_agent: row.created_by_agent,
            created_at: row.created_at,
        }
    }
}

/// [`ArtifactRepository`] over MacroDB.
#[derive(Clone)]
pub struct PgArtifactRepository {
    pool: PgPool,
}

impl PgArtifactRepository {
    /// A repository over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ArtifactRepository for PgArtifactRepository {
    #[tracing::instrument(skip(self), err)]
    async fn current_version(&self, document_id: &str) -> anyhow::Result<Option<ArtifactVersion>> {
        let row = sqlx::query_as!(
            VersionRow,
            r#"
            SELECT
                number,
                files AS "files: Json<BTreeMap<String, FileColumn>>",
                scenes AS "scenes: Json<Vec<SceneColumn>>",
                message,
                created_by,
                created_by_agent,
                created_at
            FROM artifact_versions
            WHERE document_id = $1
            ORDER BY number DESC
            LIMIT 1
            "#,
            document_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(ArtifactVersion::from))
    }

    #[tracing::instrument(skip(self), err)]
    async fn version(
        &self,
        document_id: &str,
        number: i32,
    ) -> anyhow::Result<Option<ArtifactVersion>> {
        let row = sqlx::query_as!(
            VersionRow,
            r#"
            SELECT
                number,
                files AS "files: Json<BTreeMap<String, FileColumn>>",
                scenes AS "scenes: Json<Vec<SceneColumn>>",
                message,
                created_by,
                created_by_agent,
                created_at
            FROM artifact_versions
            WHERE document_id = $1 AND number = $2
            "#,
            document_id,
            number,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(ArtifactVersion::from))
    }

    #[tracing::instrument(skip(self), err)]
    async fn versions(&self, document_id: &str) -> anyhow::Result<Vec<ArtifactVersionSummary>> {
        let rows = sqlx::query!(
            r#"
            SELECT
                number,
                message,
                created_by,
                created_by_agent,
                created_at,
                (SELECT count(*) FROM jsonb_object_keys(files)) AS "file_count!",
                (SELECT coalesce(sum((value->>'size')::bigint), 0) FROM jsonb_each(files))::bigint AS "total_size!"
            FROM artifact_versions
            WHERE document_id = $1
            ORDER BY number DESC
            "#,
            document_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(ArtifactVersionSummary {
                    number: row.number,
                    message: row.message,
                    created_by: row.created_by,
                    created_by_agent: row.created_by_agent,
                    created_at: row.created_at,
                    file_count: usize::try_from(row.file_count)?,
                    total_size: u64::try_from(row.total_size)?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip(self, digests), fields(digests = digests.len()), err)]
    async fn recorded_sizes(
        &self,
        document_id: &str,
        digests: &HashSet<Sha256>,
    ) -> anyhow::Result<HashMap<Sha256, u64>> {
        if digests.is_empty() {
            return Ok(HashMap::new());
        }

        let digests: Vec<String> = digests
            .iter()
            .map(|digest| digest.as_str().to_string())
            .collect();
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT
                file.value->>'sha256' AS "sha256!",
                (file.value->>'size')::bigint AS "size!"
            FROM artifact_versions version, jsonb_each(version.files) file
            WHERE version.document_id = $1 AND file.value->>'sha256' = ANY($2)
            "#,
            document_id,
            &digests,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| Ok((Sha256(row.sha256), u64::try_from(row.size)?)))
            .collect()
    }

    #[tracing::instrument(skip(self, version), fields(document_id = version.document_id.as_str(), number = version.number), err)]
    async fn insert_version(&self, version: NewVersion) -> anyhow::Result<Option<ArtifactVersion>> {
        let files: BTreeMap<String, FileColumn> = version
            .manifest
            .files
            .into_iter()
            .map(|(path, file)| {
                (
                    path.0,
                    FileColumn {
                        sha256: file.sha256.0,
                        size: file.size,
                        content_type: file.content_type,
                    },
                )
            })
            .collect();
        let scenes: Vec<SceneColumn> = version
            .manifest
            .scenes
            .into_iter()
            .map(|scene| SceneColumn {
                id: scene.id.0,
                title: scene.title,
                path: scene.path.0,
            })
            .collect();

        let row = sqlx::query_as!(
            VersionRow,
            r#"
            INSERT INTO artifact_versions
                (document_id, number, files, scenes, message, created_by, created_by_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (document_id, number) DO NOTHING
            RETURNING
                number,
                files AS "files: Json<BTreeMap<String, FileColumn>>",
                scenes AS "scenes: Json<Vec<SceneColumn>>",
                message,
                created_by,
                created_by_agent,
                created_at
            "#,
            version.document_id,
            version.number,
            Json(files) as _,
            Json(scenes) as _,
            version.message,
            version.created_by,
            version.created_by_agent,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(ArtifactVersion::from))
    }
}
