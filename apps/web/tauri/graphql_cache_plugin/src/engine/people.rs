//! Native person-policy calls retain the shared engine lock through admission.
use super::{EngineHandle, EngineState, WriteResultWire, wire_write_result};
use cache_core::{
    engine::HydrationScope,
    people::{ContextState, ContextUpdate, PeopleSearch, PeopleSearchResult},
};

impl EngineHandle {
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
