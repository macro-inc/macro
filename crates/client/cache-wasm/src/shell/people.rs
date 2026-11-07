//! Thin person-policy ABI; scope admission and ranking stay in the locked core.
use super::{CacheEngine, err_js, js_write_result, to_js};
use cache_core::{
    engine::HydrationScope,
    people::{ContextUpdate, PeopleReferenceRequest, PeopleSearch},
};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[wasm_bindgen]
impl CacheEngine {
    /// Resolve bounded label evidence without exposing the cached directory.
    #[wasm_bindgen(js_name = peopleResolveReferences)]
    pub fn people_resolve_references(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: PeopleReferenceRequest =
                serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            let result = state
                .engine_mut()?
                .resolve_people_references(&request)
                .await;
            to_js(&state.engine_result(result)?)
        })
    }

    /// Inspect publication without scanning contacts.
    #[wasm_bindgen(js_name = peopleContext)]
    pub fn people_context(&self, scope: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let scope: HydrationScope = serde_wasm_bindgen::from_value(scope).map_err(err_js)?;
            let result = state.engine_mut()?.people_context_state(&scope).await;
            to_js(&state.engine_result(result)?)
        })
    }
    /// Publish bounded local facts without changing account or public membership.
    #[wasm_bindgen(js_name = peopleUpdate)]
    pub fn people_update(&self, update: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let update: ContextUpdate = serde_wasm_bindgen::from_value(update).map_err(err_js)?;
            let result = state.engine_mut()?.update_people_context(&update).await;
            let result = state.engine_result(result)?;
            to_js(&js_write_result(result, &ops.borrow()))
        })
    }
    /// Return only bounded winners after context-aware exclusions and ranking.
    #[wasm_bindgen(js_name = peopleSearch)]
    pub fn people_search(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: PeopleSearch = serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            let result = state.engine_mut()?.search_people(&request).await;
            to_js(&state.engine_result(result)?)
        })
    }
}
