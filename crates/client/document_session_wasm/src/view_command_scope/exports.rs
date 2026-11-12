use super::*;
fn run(scope: u64, operation: Operation) -> Result<Value, JsValue> {
    execute_current(scope, operation).map_err(host::error)
}
/// Read the actual pending selection using the existing SelectionMsg encoding.
#[wasm_bindgen(js_name=viewCommandScopeSelection)]
pub fn selection(scope: u64) -> Result<Vec<u8>, JsValue> {
    match run(scope, Operation::Selection)? {
        Value::Bytes(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Read pending node text without consulting the published view mirror.
#[wasm_bindgen(js_name=viewCommandScopeText)]
pub fn text(scope: u64, key: u32) -> Result<String, JsValue> {
    match run(scope, Operation::Text(key))? {
        Value::Text(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Export one pending node's own JSON through its actual configured hook.
#[wasm_bindgen(js_name=viewCommandScopeOwnJSON)]
pub fn own_json(scope: u64, key: u32) -> Result<String, JsValue> {
    match run(scope, Operation::OwnJSON(key))? {
        Value::Text(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Apply an explicit view selection to the borrowed transaction.
#[wasm_bindgen(js_name=viewCommandScopeSetSelection)]
pub fn set_selection(scope: u64, encoded: &[u8]) -> Result<(), JsValue> {
    let value = wire::SelectionMsg::deserialize(encoded).map_err(|e| host::error(e.into()))?;
    run(scope, Operation::SetSelection(value))?;
    Ok(())
}
/// Dispatch a whitelisted ordinary command or current-generation application.
#[wasm_bindgen(js_name=viewCommandScopeDispatch)]
pub fn dispatch(scope: u64, encoded: &[u8]) -> Result<bool, JsValue> {
    let value = wire::EditorInputMsg::deserialize(encoded).map_err(|e| host::error(e.into()))?;
    match run(scope, Operation::Dispatch(value))? {
        Value::Handled(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Dispatch a nested programmatic Enter; its JS payload is explicitly null.
#[wasm_bindgen(js_name=viewCommandScopeEnter)]
pub fn enter(scope: u64) -> Result<bool, JsValue> {
    match run(scope, Operation::Enter)? {
        Value::Handled(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Append or deduplicate an Enter listener in the actual current transaction.
#[wasm_bindgen(js_name=viewCommandScopeRegisterEnter)]
pub fn register(scope: u64, callback: u64, priority: u8) -> Result<u64, JsValue> {
    match run(scope, Operation::Register(callback, priority))? {
        Value::Handle(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Remove an actual listener while preserving current native bucket snapshots.
#[wasm_bindgen(js_name=viewCommandScopeUnregisterEnter)]
pub fn unregister(scope: u64, handle: u64) -> Result<(), JsValue> {
    run(scope, Operation::Unregister(handle))?;
    Ok(())
}

/// Dispatch a nested programmatic Escape with an explicit null JS payload.
#[wasm_bindgen(js_name=viewCommandScopeEscape)]
pub fn escape(scope: u64) -> Result<bool, JsValue> {
    match run(scope, Operation::Escape)? {
        Value::Handled(value) => Ok(value),
        _ => Err(host::error(BoundaryError::Invalid(
            "view command scope result",
        ))),
    }
}
/// Append or deduplicate an Escape listener in the current transaction.
#[wasm_bindgen(js_name=viewCommandScopeRegisterEscape)]
pub fn register_escape(scope: u64, callback: u64, priority: u8) -> Result<u64, JsValue> {
    match run(scope, Operation::RegisterEscape(callback, priority))? {
        Value::Handle(value) => Ok(value),
        _ => Err(host::error(BoundaryError::Invalid(
            "view command scope result",
        ))),
    }
}
/// Remove an Escape registration while retaining current bucket snapshots.
#[wasm_bindgen(js_name=viewCommandScopeUnregisterEscape)]
pub fn unregister_escape(scope: u64, handle: u64) -> Result<(), JsValue> {
    run(scope, Operation::Unregister(handle))?;
    Ok(())
}

/// Request observation retirement from the exact current callback metadata scope.
/// The native epilogue performs retirement after callback/model borrows end.
#[wasm_bindgen(js_name=requestRetireViewObservation)]
pub fn request_retire(owner: u64, invocation: u64, scope: u64) -> Result<(), JsValue> {
    request_retire_current(owner, invocation, scope).map_err(host::error)
}

/// Issue a one-shot plan from the current fixed vertical-navigation callback.
#[wasm_bindgen(js_name=viewCommandScopePrepareBlockNavigation)]
pub fn prepare_block_navigation(scope: u64) -> Result<u64, JsValue> {
    match run(scope, Operation::NavigationPrepare)? {
        Value::Handle(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Return only the issued DOM measurement key, never a mutable host target.
#[wasm_bindgen(js_name=viewCommandScopeBlockNavigationBlock)]
pub fn block_navigation_block(scope: u64, plan: u64) -> Result<Option<u32>, JsValue> {
    match run(scope, Operation::NavigationBlock(plan))? {
        Value::Key(value) => Ok(value),
        _ => unreachable!(),
    }
}
/// Consume the exact issued plan before validating optional fresh DOM geometry.
#[wasm_bindgen(js_name=viewCommandScopeCompleteBlockNavigation)]
pub fn complete_block_navigation(
    scope: u64,
    plan: u64,
    block_top: Option<f64>,
    block_bottom: Option<f64>,
    caret_top: Option<f64>,
    caret_bottom: Option<f64>,
    caret_height: Option<f64>,
) -> Result<bool, JsValue> {
    // Missing geometry declines geometry plans; direct root/node plans still run.
    let rects = match (
        block_top,
        block_bottom,
        caret_top,
        caret_bottom,
        caret_height,
    ) {
        (
            Some(block_top),
            Some(block_bottom),
            Some(caret_top),
            Some(caret_bottom),
            Some(caret_height),
        ) => Ok(Some(
            macro_document_model::plugins_group_b::block_navigation::EdgeRects {
                block_top,
                block_bottom,
                caret_top,
                caret_bottom,
                caret_height,
            },
        )),
        (None, None, None, None, None) => Ok(None),
        _ => Err("partial block navigation geometry"),
    };
    match run(scope, Operation::NavigationComplete(plan, rects))? {
        Value::Handled(value) => Ok(value),
        _ => unreachable!(),
    }
}

/// Consume an issued plan after host teardown or failed measurement, without selecting.
#[wasm_bindgen(js_name=viewCommandScopeCancelBlockNavigation)]
pub fn cancel_block_navigation(scope: u64, plan: u64) -> Result<(), JsValue> {
    run(scope, Operation::NavigationCancel(plan))?;
    Ok(())
}
