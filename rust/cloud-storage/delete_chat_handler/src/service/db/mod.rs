mod delete_chat;
mod get_chat;

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
    pub async fn is_chat_deleted(&self, chat_id: &str) -> anyhow::Result<bool> {
        get_chat::is_chat_deleted(self.inner.clone(), chat_id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_chat(&self, chat_id: &str) -> anyhow::Result<()> {
        delete_chat::delete_chat(self.inner.clone(), chat_id).await
    }
}
