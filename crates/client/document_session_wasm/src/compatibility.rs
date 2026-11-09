//! Production compatibility state belongs to the existing editor session.
use crate::compatibility_generated::owned as compat;
use crate::*;
use lexical_model::{EditorState, ForeignReadSnapshot, PendingUpdate};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
mod audit_snapshot;
mod batch;
mod batch_execution;
mod bindings;
mod calls;
mod capture_index;
mod capture_leases;
mod capture_retirement;
mod class_masks;
mod construction;
mod instance_runtime;
mod lifecycle;
mod native_calls;
pub(crate) mod observer;
mod publication_delta;
mod records;
mod reservations;
mod scopes;
mod selection_execution;
mod selection_ops;
mod selection_values;
mod selections;

pub(crate) struct CompatFactory {
    pub receipts: observer::Receipts,
    pub keys: lexical_model::SharedKeyCounter,
    pub instances: Option<Arc<dyn lexical_model::ForeignInstanceHooks>>,
}

pub(crate) struct Host {
    editor: u32,
    version: u64,
    next_version: u64,
    pending_version: Option<u64>,
    update: u32,
    next_capture: u64,
    retirement_epoch: u64,
    capture_index: capture_index::CaptureIndex,
    capture_leases: capture_leases::CaptureLeases,
    preserve_capture_emissions: bool,
    pending: Option<PendingUpdate>,
    states: BTreeMap<u64, EditorState>,
    captures: HashMap<u64, records::Capture>,
    selection_values: selection_values::SelectionValues,
    keys: lexical_model::SharedKeyCounter,
    reservations: HashMap<
        u64,
        (
            u32,
            HashMap<lexical_model::NodeKey, lexical_model::ForeignReservedKey>,
        ),
    >,
    constructed: HashMap<(u64, lexical_model::NodeKey), compat::ForeignRecordRef>,
    next_reservation: u64,
    mutation_epoch: u64,
    class_masks: Arc<class_masks::ClassMasks>,
    host_slot: Option<u32>,
    instance_runtime: Option<Arc<instance_runtime::InstanceRuntime>>,
    receipts: observer::Receipts,
    owner: lexical_model::ForeignEditorIdentity,
    owner_aliases: std::collections::HashSet<lexical_model::ForeignWeakEditorIdentity>,
}
#[wasm_bindgen]
impl EditorSession {
    /// Create the JS-configured core with no parallel native editing plugins.
    #[wasm_bindgen(js_name = createCompat)]
    pub fn create_compat(
        abi: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        registration: &[u8],
    ) -> Result<Self, JsError> {
        Self::create_compat_inner(abi, config, now, wall, registration).map_err(js)
    }
}
impl EditorSession {
    fn create_compat_inner(
        abi: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        registration: &[u8],
    ) -> Result<Self, BoundaryError> {
        if abi != generated::ABI_MAJOR {
            return Err(BoundaryError::AbiMismatch);
        }
        let registration = compat::CompatConfig::deserialize(registration)?;
        Self::create_compat_config(abi, config, now, wall, registration, None)
    }
    fn create_compat_config(
        abi: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        registration: compat::CompatConfig,
        runtime: Option<Arc<instance_runtime::InstanceRuntime>>,
    ) -> Result<Self, BoundaryError> {
        if registration.editor_id == 0 {
            return Err(BoundaryError::Invalid("compatibility editor namespace"));
        }
        let class_masks = Arc::new(class_masks::ClassMasks::new(&registration)?);
        let receipts: observer::Receipts = Arc::default();
        let keys = if runtime.is_some() {
            static HOSTED_KEYS: std::sync::OnceLock<lexical_model::SharedKeyCounter> =
                std::sync::OnceLock::new();
            HOSTED_KEYS
                .get_or_init(lexical_model::SharedKeyCounter::new)
                .clone()
        } else {
            lexical_model::SharedKeyCounter::new()
        };
        let machine = machine::Machine::create_compat(
            abi,
            config,
            &registration,
            CompatFactory {
                receipts: receipts.clone(),
                keys: keys.clone(),
                instances: runtime.as_ref().map(
                    |runtime| -> Arc<dyn lexical_model::ForeignInstanceHooks> { runtime.clone() },
                ),
            },
            now,
            wall,
        )?;
        let machine::Session::Editor(session) = &machine.session else {
            return Err(BoundaryError::Invalid("compatibility editor surface"));
        };
        let state = session.surface().state().clone();
        let owner = state.view().foreign_instance_owner();
        let host = Host {
            editor: registration.editor_id,
            version: 0,
            next_version: 1,
            pending_version: None,
            update: 0,
            next_capture: 1,
            retirement_epoch: 0,
            capture_index: Default::default(),
            capture_leases: capture_leases::CaptureLeases::new(registration.editor_id),
            preserve_capture_emissions: false,
            pending: None,
            states: [(0, state)].into(),
            captures: HashMap::new(),
            selection_values: selection_values::SelectionValues::new(registration.editor_id),
            keys,
            reservations: HashMap::new(),
            constructed: HashMap::new(),
            next_reservation: 1,
            mutation_epoch: 0,
            class_masks,
            host_slot: runtime.as_ref().map(|runtime| runtime.host_slot),
            instance_runtime: runtime,
            receipts,
            owner_aliases: [owner.downgrade()].into(),
            owner,
        };
        Ok(Self {
            machine,
            hostname: None,
            compatibility: Some(host),
        })
    }
}
/// Exact compatibility envelope version required before editor construction.
#[wasm_bindgen]
pub fn compatibility_protocol_major() -> u32 {
    compatibility_generated::COMPATIBILITY_PROTOCOL_MAJOR
}

#[cfg(test)]
mod test;

/// Hook names in the generated production class-mask order.
#[wasm_bindgen]
pub fn compatibility_hook_index() -> Vec<String> {
    lexical_model::ForeignHook::ALL
        .iter()
        .map(|hook| hook.upstream_name().to_owned())
        .collect()
}

/// Exact generated schema fingerprint required by the production JS backend.
#[wasm_bindgen]
pub fn compatibility_schema_hash() -> String {
    compatibility_generated::COMPATIBILITY_SCHEMA_HASH.to_owned()
}

mod reconciliation;
