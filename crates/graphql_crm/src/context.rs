//! Request capabilities supplied by the application composition root.

use std::{future::Future, pin::Pin, sync::Arc};

use crm::domain::pipelines::{PipelineEntry, PipelineError, PipelineRecordType, PipelineService};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Object-safe forwarding future for the request's concrete domain service.
type ApiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, PipelineError>> + Send + 'a>>;

/// Transport-facing view of the pipeline use cases this adapter calls.
pub(crate) trait CrmPipelineApi: Send + Sync {
    fn entries<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &'a [Uuid],
    ) -> ApiFuture<'a, Vec<PipelineEntry>>;
}

/// Request-scoped CRM capability.
///
/// Type erasure keeps domain implementation parameters out of the schema's public type.
#[derive(Clone)]
pub struct CrmGraphqlContext(pub(crate) Arc<dyn CrmPipelineApi>);

impl CrmGraphqlContext {
    /// Compose the pipeline use cases.
    pub fn new<P: PipelineService>(pipelines: Arc<P>) -> Self {
        Self(Arc::new(PipelineApiAdapter(pipelines)))
    }
}

/// Thin bridge from the GraphQL viewer to the pipeline service, which owns access.
struct PipelineApiAdapter<P>(Arc<P>);

impl<P: PipelineService> CrmPipelineApi for PipelineApiAdapter<P> {
    fn entries<'a>(
        &'a self,
        viewer: &'a MacroUserIdStr<'static>,
        record_type: PipelineRecordType,
        records: &'a [Uuid],
    ) -> ApiFuture<'a, Vec<PipelineEntry>> {
        Box::pin(self.0.entries(viewer, record_type, records))
    }
}
