//! Hydrate only the returned page from the shared typed review columns.

use std::collections::HashMap;

use foreign_entity::domain::models::ForeignEntity;

use super::PgGithubPullRequestRepo;

const REVIEW_METADATA_BATCH_SIZE: usize = 100;

impl PgGithubPullRequestRepo {
    pub(super) async fn hydrate_review_metadata(
        &self,
        entities: &mut [ForeignEntity],
    ) -> Result<(), sqlx::Error> {
        for batch in entities.chunks_mut(REVIEW_METADATA_BATCH_SIZE) {
            let keys: Vec<_> = batch
                .iter()
                .map(|entity| entity.foreign_entity_id.clone())
                .collect();
            let mut tx = self.pool.begin().await?;
            sqlx::query!("SET LOCAL statement_timeout = '5s'")
                .execute(&mut *tx)
                .await?;
            let rows = sqlx::query!(
                r#"
                SELECT github_key, review_decision, requested_reviewer_github_user_ids, reviews
                FROM github_pull_request
                WHERE github_key = ANY($1::text[])
                "#,
                &keys,
            )
            .fetch_all(&mut *tx)
            .await?;
            tx.commit().await?;
            let rows: HashMap<_, _> = rows
                .into_iter()
                .map(|row| (row.github_key.clone(), row))
                .collect();
            for entity in batch {
                let Some(row) = rows.get(&entity.foreign_entity_id) else {
                    continue;
                };
                let Some(metadata) = entity.metadata.as_object_mut() else {
                    continue;
                };
                metadata.insert(
                    "reviewDecision".to_string(),
                    serde_json::json!(row.review_decision),
                );
                metadata.insert(
                    "requestedReviewerGithubUserIds".to_string(),
                    serde_json::json!(row.requested_reviewer_github_user_ids),
                );
                metadata.insert("reviews".to_string(), row.reviews.clone());
            }
        }
        Ok(())
    }
}
