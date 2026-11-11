//! Numeric class/instance ownership for the production native class lifecycle.
use super::*;
use lexical_model::*;
use std::sync::atomic::{AtomicU32, Ordering};
mod codec;
pub(super) mod creation;
mod identities;

pub(super) struct InstanceRuntime {
    pub host_slot: u32,
    pub editor: u32,
    classes: HashMap<u32, compat::ForeignClassRegistration>,
    constructors: HashMap<u32, compat::CompatHostedClass>,
    next_stage: AtomicU32,
    instances: std::sync::Mutex<identities::InstanceIds>,
    pub(super) transport: fn(
        &dyn crate::compatibility_host::CallbackScope,
        &compat::CompatHostRequest,
    ) -> Result<compat::CompatHostReply, Error>,
}
impl InstanceRuntime {
    pub fn new(config: &compat::CompatHostedConfig, host_slot: u32) -> Result<Self, BoundaryError> {
        if host_slot == 0 || config.registration.editor_id == 0 {
            return Err(BoundaryError::Invalid("hosted compatibility namespace"));
        }
        let mut classes = HashMap::new();
        for class in &config.registration.classes {
            if class.owner_id != config.registration.editor_id
                || class.class_id == 0
                || classes.insert(class.class_id, class.clone()).is_some()
            {
                return Err(BoundaryError::Invalid("hosted class namespace"));
            }
            // Generic virtual hooks need their own graph adapter. Never advertise
            // callbacks and then silently inherit them in this lifecycle slice.
            if class.hooks != 0 {
                return Err(BoundaryError::Invalid(
                    "hosted virtual hooks are not installed",
                ));
            }
        }
        for required in ["root", "text", "paragraph", "linebreak", "tab"] {
            if !classes.values().any(|class| class.type_name == required) {
                return Err(BoundaryError::Invalid("missing hosted core class"));
            }
        }
        let mut constructors = HashMap::new();
        for metadata in &config.classes {
            let class_id = metadata.class_id;
            let prototype = metadata.native_prototype;
            let class = classes
                .get(&class_id)
                .ok_or(BoundaryError::Invalid("unregistered hosted constructor"))?;
            if metadata.constructor_token == 0
                || constructors.insert(metadata.class_id, *metadata).is_some()
                || prototype == compat::CompatNativePrototype::Unknown
            {
                return Err(BoundaryError::Invalid("hosted constructor identity"));
            }
            codec::validate_storage(class, prototype)?;
        }
        if constructors.len() != classes.len() {
            return Err(BoundaryError::Invalid(
                "missing hosted constructor metadata",
            ));
        }
        Ok(Self {
            host_slot,
            editor: config.registration.editor_id,
            classes,
            constructors,
            next_stage: AtomicU32::new(1),
            instances: std::sync::Mutex::new(identities::InstanceIds::default()),
            transport: crate::compatibility_host::invoke,
        })
    }
    pub fn validate_binding(&self, class_id: u32, type_name: &str) -> Result<(), Error> {
        let class = self
            .classes
            .get(&class_id)
            .ok_or(Error::Invariant("unregistered instance class"))?;
        if class.type_name != type_name || !self.constructors.contains_key(&class_id) {
            return Err(Error::Invariant("instance class storage mismatch"));
        }
        Ok(())
    }
    pub fn claim_instance(&self, id: u32) -> Result<(), Error> {
        self.instances
            .lock()
            .map_err(|_| Error::Invariant("instance identity ledger poisoned"))?
            .claim(id)
    }
    pub fn next_stage(&self) -> Result<u32, Error> {
        self.next_stage
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| Error::Invariant("compatibility clone stage exhausted"))
    }
}
impl ForeignInstanceHooks for InstanceRuntime {
    fn validate_instance(&self, type_name: &str, instance: &ForeignInstance) -> Result<(), Error> {
        self.validate_binding(instance.class_id(), type_name)
    }
    fn clone_instance(
        &self,
        request: ForeignInstanceCloneRequest,
    ) -> Result<ForeignInstanceClone, Error> {
        let stage_id = self.next_stage()?;
        let _span =
            tracing::info_span!("editor.compat.clone", stage_id, editor_id = self.editor).entered();
        let base = request.base.clone();
        let destination_owner = request.destination_owner.clone();
        let mode = request.mode;
        let reply = super::scopes::clone_instance(self, stage_id, &request)?;
        let compat::CompatHostResult::CompatHostCloneAck { ack } = reply.result else {
            return Err(Error::Invariant("expected clone acknowledgement"));
        };
        if ack.instance_owner_id != self.editor {
            return Err(Error::Invariant("clone acknowledgement owner mismatch"));
        }
        let instance = ForeignInstance::new(destination_owner, ack.class_id, ack.instance_id)?;
        let instance = if mode == ForeignCloneMode::Ephemeral {
            instance.ephemeral()
        } else {
            instance
        };
        let type_name = request.source.view().type_name(request.constructor_key)?;
        self.validate_instance(type_name, &instance)?;
        let base = codec::base(&base, ack.base_patch)?;
        let observed_links = codec::links(ack.observed_links)?;
        let payload = codec::projection(type_name, ack.native_projection)?;
        self.claim_instance(instance.instance_id())?;
        Ok(ForeignInstanceClone {
            instance,
            base,
            observed_links,
            payload,
            // Root cache values belong to the actual JS instance. A native field
            // acknowledgement never copies strings from the source instance.
            root_cache: None,
        })
    }
}
