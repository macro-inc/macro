//! PostgreSQL adapter for personal channel-category layouts.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::category::{
    ChannelCategory, ChannelCategoryLayout, ChannelCategoryRepo, ChannelPlacement,
    ReplaceLayoutOutcome,
};

/// PostgreSQL channel-category repository.
#[derive(Clone)]
pub struct PgChannelCategoryRepo {
    pool: PgPool,
}

impl PgChannelCategoryRepo {
    /// Construct a repository from the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ChannelCategoryRepo for PgChannelCategoryRepo {
    type Err = sqlx::Error;

    async fn get_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<ChannelCategoryLayout, Self::Err> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *tx)
            .await?;
        let revision =
            sqlx::query_scalar("SELECT revision FROM channel_category_layout WHERE user_id = $1")
                .bind(user_id.as_ref())
                .fetch_optional(&mut *tx)
                .await?
                .unwrap_or(0_i64);
        let categories = sqlx::query(
            "SELECT id, name FROM channel_category WHERE user_id = $1 ORDER BY sort_order, id",
        )
        .bind(user_id.as_ref())
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| ChannelCategory {
            id: row.get("id"),
            name: row.get("name"),
        })
        .collect();

        // The visibility intersection protects reads from stale/corrupt placement rows.
        let placements = sqlx::query(
            r#"
            SELECT p.channel_id, p.category_id
            FROM user_channel_placement p
            JOIN comms_channel_participants cp
              ON cp.channel_id = p.channel_id
             AND cp.user_id = p.user_id
             AND cp.left_at IS NULL
            JOIN comms_channels c ON c.id = p.channel_id
            LEFT JOIN channel_category cat
              ON cat.user_id = p.user_id AND cat.id = p.category_id
            WHERE p.user_id = $1
              AND c.channel_type <> 'direct_message'
            ORDER BY cat.sort_order NULLS LAST, p.sort_order, p.channel_id
            "#,
        )
        .bind(user_id.as_ref())
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| ChannelPlacement {
            channel_id: row.get("channel_id"),
            category_id: row.get("category_id"),
        })
        .collect();

        let layout = ChannelCategoryLayout {
            revision,
            categories,
            placements,
        };
        tx.commit().await?;
        Ok(layout)
    }

    async fn replace_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
        mut layout: ChannelCategoryLayout,
    ) -> Result<ReplaceLayoutOutcome, Self::Err> {
        let mut tx = self.pool.begin().await?;
        // Serialize all layout replacement attempts for one user, including the
        // first write where no revision row exists yet.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(user_id.as_ref())
            .execute(&mut *tx)
            .await?;
        let current_revision: i64 = sqlx::query_scalar(
            "SELECT revision FROM channel_category_layout WHERE user_id = $1 FOR UPDATE",
        )
        .bind(user_id.as_ref())
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(0);
        if layout.revision != current_revision {
            tx.rollback().await?;
            return Ok(ReplaceLayoutOutcome::Conflict);
        }
        let channel_ids: Vec<Uuid> = layout.placements.iter().map(|p| p.channel_id).collect();
        let visible_count: i64 = sqlx::query_scalar(
            r#"
            SELECT count(*)
            FROM comms_channels c
            JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = $1
              AND cp.left_at IS NULL
              AND c.channel_type <> 'direct_message'
              AND c.id = ANY($2)
            "#,
        )
        .bind(user_id.as_ref())
        .bind(&channel_ids)
        .fetch_one(&mut *tx)
        .await?;
        if visible_count != channel_ids.len() as i64 {
            tx.rollback().await?;
            return Ok(ReplaceLayoutOutcome::Unavailable);
        }

        // Match the canonical read order in the response even when the port is
        // exercised directly: categories first, Uncategorized last, stable
        // order within each group.
        let category_order: std::collections::HashMap<Uuid, usize> = layout
            .categories
            .iter()
            .enumerate()
            .map(|(index, category)| (category.id, index))
            .collect();
        layout.placements.sort_by_key(|placement| {
            placement
                .category_id
                .and_then(|id| category_order.get(&id).copied())
                .unwrap_or(layout.categories.len())
        });

        sqlx::query("DELETE FROM user_channel_placement WHERE user_id = $1")
            .bind(user_id.as_ref())
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM channel_category WHERE user_id = $1")
            .bind(user_id.as_ref())
            .execute(&mut *tx)
            .await?;

        for (sort_order, category) in layout.categories.iter().enumerate() {
            sqlx::query(
                "INSERT INTO channel_category (id, user_id, name, sort_order) VALUES ($1, $2, $3, $4)",
            )
            .bind(category.id)
            .bind(user_id.as_ref())
            .bind(&category.name)
            .bind(sort_order as i32)
            .execute(&mut *tx)
            .await?;
        }

        let mut category_orders = std::collections::HashMap::new();
        for placement in &layout.placements {
            let sort_order = category_orders
                .entry(placement.category_id)
                .or_insert(0_i32);
            sqlx::query(
                "INSERT INTO user_channel_placement (user_id, channel_id, category_id, sort_order) VALUES ($1, $2, $3, $4)",
            )
            .bind(user_id.as_ref())
            .bind(placement.channel_id)
            .bind(placement.category_id)
            .bind(*sort_order)
            .execute(&mut *tx)
            .await?;
            *sort_order += 1;
        }
        let next_revision = current_revision + 1;
        sqlx::query(
            r#"INSERT INTO channel_category_layout (user_id, revision) VALUES ($1, $2)
               ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision"#,
        )
        .bind(user_id.as_ref())
        .bind(next_revision)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        let mut saved = layout;
        saved.revision = next_revision;
        Ok(ReplaceLayoutOutcome::Replaced(saved))
    }
}
