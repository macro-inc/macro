use anyhow::Error;
use model::insight_context::document::DocumentSummary;
use sqlx::{Executor, Postgres};

// TODO: implement
#[tracing::instrument]
pub async fn update_document_summary<'e, E, D, T>(_: E) -> Result<Vec<DocumentSummary>, Error>
where
    E: Executor<'e, Database = Postgres> + Clone,
    T: std::fmt::Debug + Sized,
{
    unimplemented!()
}
