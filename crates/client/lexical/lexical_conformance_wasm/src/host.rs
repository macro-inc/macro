//! Native-core indexed host boundary; JS callback adapters build on the same lease.
use super::{compat::KEYS, debug, host_packet::HostCommitPacket};
use lexical_conformance::api::{self, CallbackContext, Context, Session};
use lexical_model::*;
use serde::Deserialize;
use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    sync::Arc,
};
use wasm_bindgen::prelude::*;
mod native;

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
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    extends: Option<String>,
    #[serde(default, rename = "className")]
    class_name: Option<String>,
    #[serde(default)]
    overrides: Option<String>,
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
    callbacks: CallbackContext,
    owner: Arc<()>,
    errors: super::host_callbacks::Errors,
    foreign: HashMap<String, Arc<super::host_foreign::ForeignNode>>,
    started: Cell<bool>,
    transforms: RefCell<HashMap<u32, (ForeignListenerId, Arc<super::host_callbacks::Callback>)>>,
    listeners: RefCell<HashMap<u32, (ForeignListenerId, Arc<super::host_commands::Listener>)>>,
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
    fn with_callback_session<T>(
        &self,
        operation: impl FnOnce(&mut Session) -> Result<T, lexical_conformance::replay::ReplayError>,
    ) -> Result<T, JsValue> {
        let result = self.with_session(|session| Ok(operation(session)))?;
        result.map_err(|error| self.errors.convert(error))
    }
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

pub(super) fn from_js(value: JsValue) -> Result<Value, JsValue> {
    #[cfg(target_arch = "wasm32")]
    {
        super::host_input::from_js(value)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        super::host_input::value(
            serde_wasm_bindgen::Deserializer::from(value),
            &debug::add_bytes,
        )
        .map_err(|error| debug::error(error).into())
    }
}
pub(super) fn to_js(value: Value) -> Result<JsValue, JsError> {
    let result = serde::Serialize::serialize(
        &value,
        &serde_wasm_bindgen::Serializer::new()
            .serialize_maps_as_objects(true)
            .serialize_missing_as_null(true),
    )
    .map_err(debug::error)?;
    debug::json_payload(&value);
    Ok(result)
}

#[wasm_bindgen]
impl EditorHandle {
    /// Create a core registry with the instance-wide key stream. Node metadata is JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<EditorHandle, JsValue> {
        let config: Config = serde_json::from_value(from_js(config)?).map_err(debug::error)?;
        let _namespace = config.namespace;
        let mode = if config.headless {
            EditorMode::Headless
        } else {
            EditorMode::ViewAttached
        };
        let context = Context::default();
        let callbacks = context.callbacks();
        let owner = Arc::new(());
        let errors = super::host_callbacks::Errors::default();
        let mut foreign = HashMap::new();
        let mut builder = Editor::builder(mode).key_source(KeySource::Shared(KEYS.clone()));
        for definition in config.nodes {
            let mask = definition
                .overrides
                .as_deref()
                .unwrap_or("0")
                .parse::<u64>()
                .map_err(debug::error)?;
            if [
                "root",
                "paragraph",
                "text",
                "linebreak",
                "tab",
                "artificial",
            ]
            .contains(&definition.type_name.as_str())
            {
                if mask != 0 {
                    return Err(debug::error("native class overlays are not wired yet").into());
                }
                continue;
            }
            if definition.kind.is_none() {
                if mask != 0 || definition.extends.is_some() {
                    return Err(
                        debug::error("native registration cannot have foreign behavior").into(),
                    );
                }
                builder = native::register(builder, &definition.type_name).map_err(debug::error)?;
                continue;
            }
            let kind = definition.kind.ok_or_else(|| {
                debug::error(format!(
                    "node type {} needs a foreign registration",
                    definition.type_name
                ))
            })?;
            let kind = match kind.as_str() {
                "Element" => NodeKind::Element,
                "Text" => NodeKind::Text,
                "Decorator" => NodeKind::Decorator,
                "LineBreak" => NodeKind::LineBreak,
                _ => return Err(debug::error("unsupported foreign node kind").into()),
            };
            let hooks =
                Arc::new(super::host_foreign::ForeignNode::new(mask).map_err(debug::error)?);
            if foreign
                .insert(definition.type_name.clone(), hooks.clone())
                .is_some()
            {
                return Err(debug::error("duplicate foreign node type").into());
            }
            builder = builder.foreign_node(ForeignNodeType {
                type_name: definition.type_name.clone().into(),
                class_name: definition.class_name.unwrap_or(definition.type_name).into(),
                kind,
                extends: definition
                    .extends
                    .map(|name| &*Box::leak(name.into_boxed_str())),
                required_state: vec![],
                hooks,
            });
        }
        let editor = builder.build().map_err(debug::error)?;
        let session = Session::with_context(editor, context).map_err(debug::error)?;
        Ok(debug::returned_handle(Self {
            session: RefCell::new(Some(session)),
            callbacks,
            owner,
            errors,
            foreign,
            started: Cell::new(false),
            transforms: RefCell::default(),
            listeners: RefCell::default(),
            _lifetime: debug::LiveEditor::new(),
        }))
    }
    /// Attach the JS-owned weak forwarding function before opening any update.
    pub fn install_foreign(
        &self,
        type_name: &str,
        function: js_sys::Function,
    ) -> Result<(), JsValue> {
        if self.started.get() {
            return Err(debug::error("install foreign dispatchers before the first update").into());
        }
        let node = self
            .foreign
            .get(type_name)
            .ok_or_else(|| debug::error("unknown foreign node type"))?;
        let callback = super::host_callbacks::Callback::new(
            function,
            self.callbacks.clone(),
            self.owner.clone(),
            self.errors.clone(),
        )?;
        node.install(Arc::new(callback));
        Ok(())
    }
    /// Refresh one supported foreign mask; native-to-JS flips freeze on first update.
    pub fn set_foreign_mask(&self, type_name: &str, mask: &str) -> Result<(), JsError> {
        let mask = mask.parse::<u64>().map_err(debug::error)?;
        self.foreign
            .get(type_name)
            .ok_or_else(|| debug::error("unknown foreign node type"))?
            .set_mask(mask, self.started.get())
            .map_err(debug::error)
    }
    /// Stable IDs from the same dispatch table as the Tier A replayer.
    pub fn api_index() -> Vec<String> {
        api::index()
            .iter()
            .map(|name| debug::returned_string((*name).to_owned()))
            .collect()
    }
    /// Read authoritative dirty sets from the live or owned callback scope.
    pub fn update_metadata(&self) -> Result<JsValue, JsValue> {
        let available = self.session.borrow().is_some();
        let facts = if available {
            self.with_session(|session| session.update_facts().map_err(debug::error))?
        } else {
            super::host_callbacks::update_facts(&self.owner)?
        };
        let metadata = super::host_packet::HostUpdateMetadata::from_update_facts(&facts);
        let value = serde_json::to_value(metadata).map_err(debug::error)?;
        to_js(value).map_err(Into::into)
    }
    /// Dispatch `{args:[...], this?: encodedHandle}` inside the pending update.
    pub fn call(&self, api_id: u32, args: JsValue) -> Result<JsValue, JsValue> {
        let call: Call = serde_json::from_value(from_js(args)?).map_err(debug::error)?;
        let available = self.session.borrow().is_some();
        let result = if available {
            self.with_callback_session(|session| session.call(api_id, call.args, call.receiver))?
        } else {
            super::host_callbacks::call(&self.owner, api_id, call.args, call.receiver)?
        };
        to_js(result).map_err(Into::into)
    }
    /// Invoke the nearest native ancestor hook using the indexed call envelope.
    /// Explicit targeting of an older native prototype is not supported here.
    pub fn call_native(&self, api_id: u32, args: JsValue) -> Result<JsValue, JsValue> {
        let call: Call = serde_json::from_value(from_js(args)?).map_err(debug::error)?;
        let receiver = call
            .receiver
            .ok_or_else(|| debug::error("native-super needs a receiver"))?;
        let available = self.session.borrow().is_some();
        let result = if available {
            self.with_callback_session(|session| session.call_native(api_id, call.args, receiver))?
        } else {
            super::host_callbacks::call_native(&self.owner, api_id, call.args, receiver)?
        };
        to_js(result).map_err(Into::into)
    }
    /// Read a retained published version with this editor associated.
    /// This leaves suspended writes untouched and never flushes or publishes.
    pub fn read_state(
        &self,
        version: &str,
        callback: &js_sys::Function,
    ) -> Result<JsValue, JsValue> {
        let version = version.parse::<u64>().map_err(debug::error)?;
        let available = self.session.borrow().is_some();
        let result = if available {
            self.with_callback_session(|session| {
                session.read_state(version, |peer| {
                    super::host_callbacks::invoke_state(&self.owner, &self.errors, peer, callback)
                })
            })?
        } else {
            super::host_callbacks::read_state(&self.owner, version, callback)?
        };
        Ok(debug::returned_handle(result))
    }
    /// Open one unpublished update. Discrete scheduling belongs to the JS host.
    pub fn begin_update(&self, tags: JsValue, discrete: bool) -> Result<(), JsValue> {
        let tags: Vec<String> = serde_json::from_value(from_js(tags)?).map_err(debug::error)?;
        let tags = tags
            .into_iter()
            .map(|tag| tag.parse())
            .collect::<Result<Vec<UpdateTag>, _>>()
            .map_err(debug::error)?;
        let tags = TagSet::from_tags(tags);
        let _discrete = discrete;
        if self.foreign.values().any(|node| !node.ready()) {
            return Err(debug::error("foreign dispatcher is not installed").into());
        }
        self.with_session(|session| session.begin_update(tags).map_err(debug::error))?;
        self.started.set(true);
        Ok(())
    }
    /// Run normal model normalization and transforms without publishing.
    pub fn flush(&self) -> Result<(), JsValue> {
        self.with_callback_session(|session| session.flush())
    }
    /// Close an unchanged update while retaining detached API values; false leaves it open.
    pub fn finish_noop(&self) -> Result<bool, JsValue> {
        let finished = self.with_callback_session(|session| session.finish_noop())?;
        debug::json_payload(&Value::Bool(finished));
        Ok(finished)
    }
    /// Encode the flat diff and host metadata before publishing pending model effects.
    pub fn commit(&self) -> Result<Vec<u8>, JsValue> {
        let buffer = self.with_callback_session(|session| {
            let (_, buffer) = session.commit_prepared(|commit, version| {
                let packet = HostCommitPacket::from_commit(commit, version)?;
                postcard::to_stdvec(&packet).map_err(|error| {
                    lexical_conformance::replay::ReplayError::Mismatch(error.to_string())
                })
            })?;
            Ok(buffer)
        })?;
        debug::returned_bytes(&buffer);
        Ok(buffer)
    }
    /// Roll back an interrupted JS update and release its unpublished handles.
    pub fn discard_update(&self) -> Result<(), JsError> {
        self.with_session(|session| session.discard_update().map_err(debug::error))
    }
    /// Read captured raw fields without borrowing a model operation across conversion.
    pub fn read_field(&self, handle: u32, field: &str) -> Result<JsValue, JsValue> {
        let available = self.session.borrow().is_some();
        let value = if available {
            self.with_session(|session| session.read_field(handle, field).map_err(debug::error))?
        } else {
            super::host_callbacks::read_field(&self.owner, handle, field)?
        };
        to_js(value).map_err(Into::into)
    }
    /// Register a JS transform in the normal model fixpoint pipeline.
    pub fn register_transform(
        &self,
        type_name: &str,
        dispatch: js_sys::Function,
    ) -> Result<u32, JsValue> {
        let existing = self
            .transforms
            .borrow()
            .values()
            .find_map(|(_, callback)| callback.matches(&dispatch).then(|| callback.clone()));
        let callback = match existing {
            Some(callback) => callback,
            None => Arc::new(super::host_callbacks::Callback::new(
                dispatch,
                self.callbacks.clone(),
                self.owner.clone(),
                self.errors.clone(),
            )?),
        };
        let available = self.session.borrow().is_some();
        let id = if available {
            self.with_session(|session| {
                session
                    .register_transform(type_name, callback.clone())
                    .map_err(debug::error)
            })?
        } else {
            super::host_callbacks::register(&self.owner, type_name, callback.clone())?
        };
        self.transforms
            .borrow_mut()
            .insert(id.get(), (id, callback));
        Ok(debug::returned_handle(id.get()))
    }
    /// Remove a registered transform or listener; repeated calls are harmless.
    pub fn unregister(&self, id: u32) -> Result<(), JsValue> {
        let registered = self
            .transforms
            .borrow()
            .get(&id)
            .map(|(registered, _)| *registered);
        if let Some(registered) = registered {
            let available = self.session.borrow().is_some();
            if available {
                self.with_session(|session| {
                    session.unregister_transform(registered);
                    Ok(())
                })?
            } else {
                super::host_callbacks::unregister(&self.owner, registered)?;
            }
            self.transforms.borrow_mut().remove(&id);
        }
        let listener = self
            .listeners
            .borrow()
            .get(&id)
            .map(|(registered, _)| *registered);
        if let Some(listener) = listener {
            let available = self.session.borrow().is_some();
            if available {
                self.with_session(|session| {
                    session.unregister_listener(listener);
                    Ok(())
                })?;
            } else {
                super::host_callbacks::unlisten(&self.owner, listener)?;
            }
            self.listeners.borrow_mut().remove(&id);
        }
        Ok(())
    }
    /// Register one JS command identity at a model priority, preserving callback identity.
    pub fn register_listener(
        &self,
        command: &str,
        priority: u32,
        dispatch: js_sys::Function,
    ) -> Result<u32, JsValue> {
        let registration = super::host_commands::registration(priority)?;
        let existing = self.listeners.borrow().values().find_map(|(_, listener)| {
            listener
                .matches(command, &dispatch)
                .then(|| listener.clone())
        });
        let listener = match existing {
            Some(listener) => listener,
            None => Arc::new(super::host_commands::Listener::new(
                command,
                Arc::new(super::host_callbacks::Callback::new(
                    dispatch,
                    self.callbacks.clone(),
                    self.owner.clone(),
                    self.errors.clone(),
                )?),
            )),
        };
        let available = self.session.borrow().is_some();
        let id = if available {
            self.with_session(|session| {
                Ok(session.register_listener(registration, listener.clone()))
            })?
        } else {
            super::host_callbacks::listen(&self.owner, registration, listener.clone())?
        };
        self.listeners.borrow_mut().insert(id.get(), (id, listener));
        Ok(debug::returned_handle(id.get()))
    }
    /// Dispatch an opaque JS payload through model listeners in the current update.
    pub fn dispatch_command(&self, command: &str, payload: JsValue) -> Result<bool, JsValue> {
        let command = super::host_commands::command(command, payload);
        let available = self.session.borrow().is_some();
        let handled = if available {
            self.with_callback_session(|session| session.dispatch_command(&command))?
        } else {
            super::host_callbacks::command(&self.owner, &command)?
        };
        let result = handled == Handled::Yes;
        debug::json_payload(&Value::Bool(result));
        Ok(result)
    }
    /// Release state-owned handles after JS state collection; versions are decimal strings.
    pub fn release_version(&self, version: &str) -> Result<(), JsError> {
        let version = version.parse().map_err(debug::error)?;
        self.with_session(|session| session.release_version(version).map_err(debug::error))
    }
}
