use std::sync::Arc;

use http::Extensions;
use js_sys::wasm_bindgen::{JsCast, JsValue};
use js_sys::{Array, Reflect};
use reqwest_middleware::Next;
use reqwest_middleware::reqwest::{Request, Response};
use reqwest_middleware::{
    Middleware,
    reqwest::header::{HeaderMap, HeaderName, HeaderValue},
};

trait JsCastRes: Sized {
    /// attempt to cast the jsvalue into T at runtime
    fn cast<T: JsCast>(self) -> Result<T, JsValue>;
    /// uses cast and logs the error if the received value was incorrect
    fn cast_and_log<T: JsCast>(self) -> Option<T> {
        match self.cast() {
            Ok(v) => Some(v),
            Err(e) => {
                web_sys::console::log_2(
                    &JsValue::from_str(&format!(
                        "Expected to receive a value of type {}, but instead received:",
                        std::any::type_name::<T>()
                    )),
                    &e,
                );
                None
            }
        }
    }
}

impl JsCastRes for Result<JsValue, JsValue> {
    fn cast<T: JsCast>(self) -> Result<T, JsValue> {
        self.and_then(|ok| ok.dyn_into())
    }
}

/// Helper function to convert web_sys::Headers to reqwest::HeaderMap
fn headers_to_headermap(headers: &web_sys::Headers) -> HeaderMap {
    let mut map = HeaderMap::new();

    // Get the entries iterator
    let entries = headers.entries();

    loop {
        let Ok(next) = entries.next() else {
            web_sys::console::log_1(&JsValue::from_str("Failed to get next entry"));
            break;
        };

        // Check if done
        let done = Reflect::get(&next, &JsValue::from_str("done"))
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if done {
            break;
        }

        // Get the value [name, value]
        if let Ok(value) = Reflect::get(&next, &JsValue::from_str("value")) {
            if let Ok(array) = value.dyn_into::<Array>() {
                if let (Some(name), Some(val)) =
                    (array.get(0).as_string(), array.get(1).as_string())
                {
                    if let (Ok(header_name), Ok(header_value)) = (
                        HeaderName::from_bytes(name.as_bytes()),
                        HeaderValue::from_str(&val),
                    ) {
                        map.insert(header_name, header_value);
                    }
                }
            }
        }
    }

    map
}

pub struct JsHeaderMiddleware {
    inner: Arc<dyn Fn() -> HeaderMap>,
}

// SAFETY: browser based wasm only has 1 thread so this is never actually sent
// THIS IS UNSOUND IN THREADED WASM ENVIRONMENTS
unsafe impl Send for JsHeaderMiddleware {}
unsafe impl Sync for JsHeaderMiddleware {}

impl JsHeaderMiddleware {
    pub fn new(f: js_sys::Function) -> Self {
        let inner = Arc::new(move || {
            let Some(res) = f
                .call0(&JsValue::UNDEFINED)
                .cast_and_log::<web_sys::Headers>()
            else {
                return HeaderMap::default();
            };
            headers_to_headermap(&res)
        });

        Self { inner }
    }
}

#[async_trait::async_trait(?Send)]
impl Middleware for JsHeaderMiddleware {
    async fn handle(
        &self,
        mut req: Request,
        extensions: &mut Extensions,
        next: Next<'_>,
    ) -> Result<Response, reqwest_middleware::Error> {
        let headers = req.headers_mut();
        let merge = (self.inner)();

        headers.extend(merge.into_iter().filter_map(|(k, v)| Some((k?, v))));

        next.run(req, extensions).await
    }
}
