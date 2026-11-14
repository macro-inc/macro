use super::*;
use cache_core::engine::authority::AuthorityTransitionWire;

#[wasm_bindgen]
impl CacheEngine {
    /// Capture before requesting permission or response content.
    #[wasm_bindgen(js_name = currentAuthority)]
    pub fn current_authority(&self, identity: String) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let result = state.engine_mut()?.current_authority(&identity).await;
            to_js(&state.engine_result(result)?)
        })
    }

    /// The serial owner dispatcher checks admission before executing each RPC.
    #[wasm_bindgen(js_name = checkAuthority)]
    pub fn check_authority(
        &self,
        generation: Option<String>,
        require_proof: bool,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            let generation = generation
                .map(|value| value.parse::<uuid::Uuid>())
                .transpose()
                .map_err(err_js)?;
            let result = state
                .engine_mut()?
                .check_authority_generation(generation, require_proof)
                .await;
            state.engine_result(result)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Compare a fresh proof and retire its old snapshots while the owner is locked.
    #[wasm_bindgen(js_name = transitionAuthority)]
    pub fn transition_authority(
        &self,
        identity: String,
        expected: String,
        policy: String,
    ) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let expected = expected.parse::<uuid::Uuid>().map_err(err_js)?;
            let mut state = state.lock().await;
            let result = soup_filter_cache_adapter::permissions::transition_crm_authority(
                state.engine_mut()?,
                &identity,
                expected,
                policy,
            )
            .await;
            let result = state.engine_result(result)?;
            to_js(&AuthorityTransitionWire {
                authority: result.authority,
                revision: result.revision.to_string(),
                affected_ops: ops.borrow().names(result.affected_ops),
                changed: result.changed,
            })
        })
    }
}
