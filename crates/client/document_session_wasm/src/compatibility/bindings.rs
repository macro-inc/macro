//! Hosted construction and exact read-only hydration on the existing core.
use super::*;
use lexical_model::*;

impl EditorSession {
    fn create_compat_hosted_inner(
        abi: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        registration: &[u8],
        host_slot: u32,
    ) -> Result<Self, BoundaryError> {
        if abi != generated::ABI_MAJOR {
            return Err(BoundaryError::AbiMismatch);
        }
        let config_classes = compat::CompatHostedConfig::deserialize(registration)?;
        let runtime = Arc::new(instance_runtime::InstanceRuntime::new(
            &config_classes,
            host_slot,
        )?);
        Self::create_compat_config(
            abi,
            config,
            now,
            wall,
            config_classes.registration,
            Some(runtime),
        )
    }
    fn compat_bind_instance_inner(
        &mut self,
        bytes: &[u8],
    ) -> Result<compat::ForeignRenderRecord, BoundaryError> {
        let binding = compat::CompatInstanceBind::deserialize(bytes)?;
        let (host, _) = self.compat_parts()?;
        let version = binding.record.node.version;
        if host.pending.is_some()
            || !host.states.contains_key(&version)
            || binding.record.update_id != 0
            || !matches!(
                binding.record.access,
                compat::ForeignAccess::Frozen | compat::ForeignAccess::Read
            )
        {
            return Err(BoundaryError::Invalid(
                "pending instance hydration requires the creation adapter",
            ));
        }
        let runtime = host
            .instance_runtime
            .as_ref()
            .ok_or(BoundaryError::Invalid("hosted instance runtime required"))?;
        if binding.instance_owner_id != host.editor
            || binding.instance_id == 0
            || binding.class_id == 0
        {
            return Err(BoundaryError::Invalid("instance binding namespace"));
        }
        let key = host.receiver(&compat::CompatRequest {
            operation: compat::CompatOperation::GetLatest,
            historical: true,
            state_version: binding.record.node.version,
            has_receiver: true,
            receiver: binding.record,
            args: vec![],
        })?;
        let capture_id = binding.record.capture_id;
        let capture = host
            .captures
            .get(&capture_id)
            .ok_or(BoundaryError::Invalid("unknown compatibility capture"))?;
        let source = capture.source.clone();
        let identity = capture.identity.clone();
        let publication = host.states.get(&version).ok_or(BoundaryError::Invalid(
            "instance binding publication is not retained",
        ))?;
        if publication.view().foreign_record_identity(key)? != identity {
            return Err(BoundaryError::Invalid(
                "instance binding is not an exact publication record",
            ));
        }
        runtime.validate_binding(binding.class_id, source.view().type_name(key)?)?;
        if let Some(existing) = source.view().foreign_instance(key) {
            if existing.class_id() != binding.class_id
                || existing.instance_id() != binding.instance_id
                || !host.owner_aliases.contains(&existing.owner().downgrade())
            {
                return Err(BoundaryError::Invalid("instance record is already bound"));
            }
        } else {
            ForeignReadOperation::check()?;
            runtime.claim_instance(binding.instance_id)?;
            source.view().bind_foreign_instance(
                key,
                &identity,
                ForeignInstance::new(
                    source.view().foreign_instance_owner(),
                    binding.class_id,
                    binding.instance_id,
                )?,
            )?;
        }
        let mut records = host.records(
            source,
            vec![key],
            binding.record.node.version,
            binding.record.update_id,
            binding.record.access,
            records::CaptureOptions {
                writable: if binding.record.access == compat::ForeignAccess::Writable {
                    std::slice::from_ref(&key)
                } else {
                    &[]
                },
                include_root_cache: false,
            },
        )?;
        records
            .pop()
            .ok_or(BoundaryError::Invalid("bound record is missing"))
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Construct the same core with registered numeric JS class lifecycle metadata.
    #[wasm_bindgen(js_name = createCompatHosted)]
    pub fn create_compat_hosted(
        abi: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        registration: &[u8],
        host_slot: u32,
    ) -> Result<Self, JsError> {
        #[cfg(target_arch = "wasm32")]
        crate::compatibility_host::require_dispatcher_installed()
            .map_err(|error| js(BoundaryError::Model(error)))?;
        Self::create_compat_hosted_inner(abi, config, now, wall, registration, host_slot)
            .map_err(js)
    }
    /// Hydrate an issued exact record without cloning, dirtying or changing its graph.
    #[wasm_bindgen(js_name = compatBindInstance)]
    pub fn compat_bind_instance(&mut self, bytes: &[u8]) -> Result<Vec<u8>, JsError> {
        self.compat_bind_instance_inner(bytes)
            .and_then(|value| super::bytes(&value))
            .map_err(js)
    }
}

#[cfg(test)]
mod test;
