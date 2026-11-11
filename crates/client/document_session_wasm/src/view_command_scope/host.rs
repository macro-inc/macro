use super::*;
struct Functions {
    dispatch: js_sys::Function,
    lookup: js_sys::Function,
}
thread_local! { static FUNCTIONS: RefCell<Option<Functions>> = const { RefCell::new(None) }; }
pub(super) struct WasmHost;
impl Host for WasmHost {
    fn dispatch(&self, call: &Call) -> Result<bool, HostFailure> {
        let dispatch = FUNCTIONS
            .with(|slot| slot.borrow().as_ref().map(|host| host.dispatch.clone()))
            .ok_or(HostFailure::Protocol)?;
        let args = js_sys::Array::new();
        for id in [
            call.owner.raw(),
            call.callback.get(),
            call.invocation.raw(),
            call.scope.raw(),
        ] {
            args.push(&js_sys::BigInt::from(id));
        }
        args.push(&JsValue::from(call.generation));
        let access = match call.access {
            doc_sync_core::Access::Read => wire::Access::Read,
            doc_sync_core::Access::CommentOnly => wire::Access::CommentOnly,
            doc_sync_core::Access::Edit => wire::Access::Edit,
        };
        args.push(&JsValue::from(u8::from(access)));
        args.push(&JsValue::from(call.programmatic));
        dispatch
            .apply(&JsValue::UNDEFINED, &args)
            .map_err(|_| HostFailure::Thrown)?
            .as_bool()
            .ok_or(HostFailure::Protocol)
    }
}
/// Install the ordinary synchronous Enter dispatcher and original-cause lookup.
/// The dispatcher owns its event stack and stores thrown values by issued scope.
#[wasm_bindgen(js_name=installViewCommandHost)]
pub fn install(dispatch: js_sys::Function, lookup: js_sys::Function) -> Result<(), JsError> {
    if INVOCATION.is_set() {
        return Err(JsError::new("view command invocation is active"));
    }
    FUNCTIONS.with(|slot| {
        let mut host = slot.borrow_mut();
        if let Some(existing) = host.as_ref() {
            if existing.dispatch != dispatch || existing.lookup != lookup {
                return Err(JsError::new("view command host already installed"));
            }
        } else {
            *host = Some(Functions { dispatch, lookup });
        }
        Ok(())
    })
}
pub(super) fn error(error: BoundaryError) -> JsValue {
    if let BoundaryError::Model(Error::Extension(source)) = &error {
        if let Some(failure) = source.downcast_ref::<CallbackFailure>() {
            let lookup =
                FUNCTIONS.with(|slot| slot.borrow().as_ref().map(|host| host.lookup.clone()));
            if let Some(lookup) = lookup {
                return match lookup.call3(
                    &JsValue::UNDEFINED,
                    &js_sys::BigInt::from(failure.owner.raw()),
                    &js_sys::BigInt::from(failure.invocation.raw()),
                    &js_sys::BigInt::from(failure.scope.raw()),
                ) {
                    Ok(cause) | Err(cause) => cause,
                };
            }
        }
    }
    JsError::new(&error.to_string()).into()
}
