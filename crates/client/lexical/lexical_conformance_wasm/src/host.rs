//! Native-core indexed host boundary; JS callback adapters build on the same lease.
use super::{compat::KEYS, debug, host_packet::HostCommitPacket};
use lexical_conformance::api::{self, Session};
use lexical_model::*;
use serde::Deserialize;
use serde_json::Value;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct Config {
    namespace: String,
    #[serde(default)]
    nodes: Vec<NodeDef>,
    #[serde(default = "headless")]
    headless: bool,
}
fn headless() -> bool {
    true
}
#[derive(Deserialize)]
struct NodeDef {
    #[serde(rename = "type")]
    type_name: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    args: Value,
    #[serde(rename = "this")]
    receiver: Option<Value>,
}

/// Editor and suspended update used by the development-only indexed API backend.
#[wasm_bindgen]
pub struct EditorHandle {
    session: RefCell<Option<Session>>,
    _lifetime: debug::LiveEditor,
}

// Move the session out before model work. Its cell is never borrowed while a
// native operation runs, so callback scopes can later supply their own reborrow.
struct Lease<'a> {
    owner: &'a RefCell<Option<Session>>,
    session: Option<Session>,
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        *self.owner.borrow_mut() = self.session.take();
    }
}
impl EditorHandle {
    fn with_session<T>(
        &self,
        operation: impl FnOnce(&mut Session) -> Result<T, JsError>,
    ) -> Result<T, JsError> {
        let session = { self.session.borrow_mut().take() };
        let session =
            session.ok_or_else(|| debug::error("editor is executing a model operation"))?;
        let mut lease = Lease {
            owner: &self.session,
            session: Some(session),
        };
        operation(lease.session.as_mut().expect("leased session"))
    }
}

fn from_js(value: JsValue) -> Result<Value, JsError> {
    let value = serde_wasm_bindgen::from_value(value).map_err(debug::error)?;
    debug::json_payload(&value);
    Ok(value)
}
fn to_js(value: Value) -> Result<JsValue, JsError> {
    let result = serde::Serialize::serialize(
        &value,
        &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
    )
    .map_err(debug::error)?;
    debug::json_payload(&value);
    Ok(result)
}

#[wasm_bindgen]
impl EditorHandle {
    /// Create a core registry with the instance-wide key stream. Node metadata is JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<EditorHandle, JsError> {
        let config: Config = serde_json::from_value(from_js(config)?).map_err(debug::error)?;
        let _namespace = config.namespace;
        for definition in config.nodes {
            if ![
                "root",
                "paragraph",
                "text",
                "linebreak",
                "tab",
                "artificial",
            ]
            .contains(&definition.type_name.as_str())
            {
                return Err(debug::error(format!(
                    "node type {} needs a foreign registration",
                    definition.type_name
                )));
            }
        }
        let mode = if config.headless {
            EditorMode::Headless
        } else {
            EditorMode::ViewAttached
        };
        let editor = Editor::builder(mode)
            .key_source(KeySource::Shared(KEYS.clone()))
            .build()
            .map_err(debug::error)?;
        Ok(debug::returned_handle(Self {
            session: RefCell::new(Some(Session::new(editor))),
            _lifetime: debug::LiveEditor::new(),
        }))
    }
    /// Stable IDs from the same dispatch table as the Tier A replayer.
    pub fn api_index() -> Vec<String> {
        api::index()
            .iter()
            .map(|name| debug::returned_string((*name).to_owned()))
            .collect()
    }
    /// Dispatch `{args:[...], this?: encodedHandle}` inside the pending update.
    pub fn call(&self, api_id: u32, args: JsValue) -> Result<JsValue, JsError> {
        let call: Call = serde_json::from_value(from_js(args)?).map_err(debug::error)?;
        let result = self.with_session(|session| {
            session
                .call(api_id, call.args, call.receiver)
                .map_err(debug::error)
        })?;
        to_js(result)
    }
    /// Open one unpublished update. Discrete scheduling belongs to the JS host.
    pub fn begin_update(&self, tags: JsValue, discrete: bool) -> Result<(), JsError> {
        let tags: Vec<String> = serde_json::from_value(from_js(tags)?).map_err(debug::error)?;
        let tags = tags
            .into_iter()
            .map(|tag| tag.parse())
            .collect::<Result<Vec<UpdateTag>, _>>()
            .map_err(debug::error)?;
        let tags = TagSet::from_tags(tags);
        let _discrete = discrete;
        self.with_session(|session| session.begin_update(tags).map_err(debug::error))
    }
    /// Run normal model normalization and transforms without publishing.
    pub fn flush(&self) -> Result<(), JsError> {
        self.with_session(|session| session.flush().map_err(debug::error))
    }
    /// Publish and encode the flat diff, changed core records and mutation metadata.
    pub fn commit(&self) -> Result<Vec<u8>, JsError> {
        let packet = self.with_session(|session| {
            let commit = session.commit().map_err(debug::error)?;
            HostCommitPacket::from_commit(&commit, session.committed_version())
                .map_err(debug::error)
        })?;
        let buffer = postcard::to_stdvec(&packet).map_err(debug::error)?;
        debug::returned_bytes(&buffer);
        Ok(buffer)
    }
    /// Roll back an interrupted JS update and release its unpublished handles.
    pub fn discard_update(&self) -> Result<(), JsError> {
        self.with_session(|session| session.discard_update().map_err(debug::error))
    }
    /// Read captured raw fields without borrowing a model operation across conversion.
    pub fn read_field(&self, handle: u32, field: &str) -> Result<JsValue, JsError> {
        let value =
            self.with_session(|session| session.read_field(handle, field).map_err(debug::error))?;
        to_js(value)
    }
    /// Release state-owned handles after JS state collection; versions are decimal strings.
    pub fn release_version(&self, version: &str) -> Result<(), JsError> {
        let version = version.parse().map_err(debug::error)?;
        self.with_session(|session| session.release_version(version).map_err(debug::error))
    }
}
