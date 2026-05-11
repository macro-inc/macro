mod create_document_text;
pub mod document_text_parts;
mod get_document_file_type;

use lambda_runtime::tracing;
#[allow(unused_imports)]
use mockall::automock;
use model::document::FileType;

#[cfg(not(test))]
pub use DBClient as DB;

#[cfg(test)]
pub use MockDBClient as DB;

use model::citations::TextReference;

#[cfg_attr(test, allow(dead_code))]
#[derive(Clone)]
pub struct DBClient {
    inner: sqlx::Pool<sqlx::Postgres>,
}

#[cfg_attr(test, automock)]
#[cfg_attr(test, allow(dead_code))]
impl DBClient {
    pub fn new(inner: sqlx::Pool<sqlx::Postgres>) -> Self {
        Self { inner }
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn create_document_text(
        &self,
        document_id: &str,
        text: &str,
        token_count: i64,
    ) -> anyhow::Result<()> {
        create_document_text::create_document_text(
            self.inner.clone(),
            document_id,
            text,
            token_count,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn insert_references(
        &self,
        references: &Vec<TextReference>,
        document_id: &str,
    ) -> anyhow::Result<()> {
        document_text_parts::insert_pdf_references(self.inner.clone(), references, document_id)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn get_document_file_type(
        &self,
        document_id: &str,
    ) -> anyhow::Result<Option<FileType>> {
        get_document_file_type::get_document_file_type(&self.inner, document_id).await
    }
}

#[cfg(test)]
mod tests {
    use crate::service::db::DB;

    #[ignore]
    #[tokio::test]
    async fn test_createdoc_text() {
        let mock = DB::default();
        let data = String::new();
        let _r = mock
            .create_document_text("document-id", data.as_str(), 0)
            .await;
    }
}
