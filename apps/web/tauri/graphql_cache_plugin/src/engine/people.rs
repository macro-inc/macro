//! Native person-policy calls retain the shared engine lock through admission.
use super::{EngineHandle, EngineState, WriteResultWire, wire_write_result};
use cache_core::{
    engine::HydrationScope,
    people::{
        ContextState, ContextUpdate, PeopleReferenceRequest, PeopleReferenceResult, PeopleSearch,
        PeopleSearchResult,
    },
};

impl EngineHandle {
    /// Execute bounded local SQL without allowing account rebinding or remote fallback.
    pub async fn people_read_sql(
        &self,
        request: cache_core::people::sql::PeopleSqlRequest,
    ) -> Result<cache_core::people::sql::PeopleSqlResult, String> {
        self.inner
            .lock()
            .await
            .engine
            .read_people_sql(&request)
            .await
            .map_err(|error| error.to_string())
    }

    /// Resolve full-directory label evidence while retaining only bounded witnesses.
    pub async fn people_resolve_references(
        &self,
        request: PeopleReferenceRequest,
    ) -> Result<PeopleReferenceResult, String> {
        self.inner
            .lock()
            .await
            .engine
            .resolve_people_references(&request)
            .await
            .map_err(|error| error.to_string())
    }

    /// Inspect the local context publication state without materializing people.
    pub async fn people_context(&self, scope: HydrationScope) -> Result<ContextState, String> {
        self.inner
            .lock()
            .await
            .engine
            .people_context_state(&scope)
            .await
            .map_err(|error| error.to_string())
    }
    /// Apply one bounded context operation under the same account/generation lock.
    pub async fn people_update(&self, update: ContextUpdate) -> Result<WriteResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let result = engine
            .update_people_context(&update)
            .await
            .map_err(|error| error.to_string())?;
        Ok(wire_write_result(ops, result))
    }
    /// Stream contacts into the shared core's bounded ranked result.
    pub async fn people_search(&self, request: PeopleSearch) -> Result<PeopleSearchResult, String> {
        self.inner
            .lock()
            .await
            .engine
            .search_people(&request)
            .await
            .map_err(|error| error.to_string())
    }
}
