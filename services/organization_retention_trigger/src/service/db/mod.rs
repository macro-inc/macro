mod get_organization_retention;
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

    #[tracing::instrument(skip(self))]
    pub async fn get_organization_retention(&self) -> anyhow::Result<Vec<(i32, i32)>> {
        get_organization_retention::get_organization_retention(self.inner.clone()).await
    }
}
