//! Admission of background responses without changing their account or data scope.

use super::*;

/// Scope captured before starting a background request. Guarded hydration never
/// switches identity or restores a response into a different storage generation.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct HydrationScope {
    /// Durable data generation observed before the network request.
    pub storage_generation: Uuid,
    /// Expected authenticated response identity, not a record identifier.
    pub identity: String,
}

impl<S: Storage> Engine<S> {
    /// Rejects obsolete background responses before normalization or persistence.
    /// Hosts must retain their engine lock throughout this call. An unbound fresh
    /// cache may bind to this identity; a bound cache may never switch accounts.
    pub async fn hydrate_query_in_scope(
        &mut self,
        write: NetworkWrite<'_>,
        scope: &HydrationScope,
        projections: Vec<ProjectionMutation>,
    ) -> Result<HydrationWriteResult, EngineError<S::Error>> {
        if scope.identity.is_empty()
            || write.identity != Some(scope.identity.as_str())
            || self.stored_storage_generation().await? != Some(scope.storage_generation)
            || self
                .current_identity()
                .await?
                .is_some_and(|identity| identity != scope.identity)
        {
            return Err(EngineError::StaleHydrationScope);
        }
        self.hydrate_query_with_projections(
            write.query,
            write.operation_name,
            write.variables,
            write.data,
            write.identity,
            projections,
        )
        .await
    }
}
