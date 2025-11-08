mod get_violating_items;
use lambda_runtime::tracing;

pub use DBClient as DB;

#[derive(Clone)]
pub struct DBClient {
    inner: sqlx::Pool<sqlx::Postgres>,
}

impl DBClient {
    pub fn new(inner: sqlx::Pool<sqlx::Postgres>) -> Self {
        Self { inner }
    }

    /// Gets all items for an organization that violate the retention policy
    #[tracing::instrument(skip(self))]
    pub async fn get_violating_items(
        &self,
        organization_id: i32,
        retention_days: i32,
    ) -> anyhow::Result<Vec<(String, String)>> {
        get_violating_items::get_violating_items(&self.inner, organization_id, retention_days).await
    }
}
