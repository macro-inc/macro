//! Typed GraphQL inbound adapter for CRM records: the pipeline rows that
//! reference a company or contact, composed onto their Soup entities.
#![deny(missing_docs)]

mod context;
mod loaders;
mod objects;

#[cfg(test)]
mod test;

pub use context::CrmGraphqlContext;
pub use loaders::{
    CrmRecord, PipelineEntriesLoader, load_pipeline_entries, pipeline_entries_loader,
};
pub use objects::{
    GraphqlCrmPipeline, GraphqlCrmPipelineCell, GraphqlCrmPipelineColumn, GraphqlCrmPipelineEntry,
    GraphqlCrmPipelineRecordType, GraphqlCrmPipelineSharing,
};

use async_graphql::ErrorExtensions;
use crm::domain::pipelines::PipelineError;

/// Preserve actionable domain failures while hiding infrastructure details.
fn graphql_error(error: PipelineError) -> async_graphql::Error {
    let (message, code) = match error {
        PipelineError::Invalid(message) => (message.to_string(), "BAD_USER_INPUT"),
        PipelineError::NotFound => ("pipeline not found".to_string(), "NOT_FOUND"),
        error => {
            tracing::error!(error=?error, "CRM pipeline GraphQL request failed");
            ("internal server error".to_string(), "INTERNAL_SERVER_ERROR")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}
