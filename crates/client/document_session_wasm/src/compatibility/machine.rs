//! Compatibility construction keeps JS registrations authoritative.
use super::*;
use crate::compatibility_generated::owned as compat;
use document_session::compatibility::compat_editor_builder;

impl Machine {
    pub(crate) fn create_compat(
        abi: u32,
        config: &[u8],
        registration: &compat::CompatConfig,
        factory: crate::compatibility::CompatFactory,
        mono: f64,
        wall: f64,
    ) -> Result<Self, BoundaryError> {
        let crate::compatibility::CompatFactory {
            receipts,
            keys,
            instances,
        } = factory;
        if abi != generated::ABI_MAJOR {
            return Err(BoundaryError::AbiMismatch);
        }
        let (mut config, headless, view_host) =
            codec::config(wire::SessionConfigMsg::deserialize(config)?)?;
        let now = codec::now(mono, wall)?;
        let mut classes = std::collections::BTreeMap::new();
        let mut ids = std::collections::BTreeSet::new();
        for class in &registration.classes {
            if class.hooks != 0 {
                return Err(BoundaryError::Invalid(
                    "compatibility callbacks are not installed",
                ));
            }
            if class.owner_id != registration.editor_id
                || class.class_id == 0
                || !ids.insert(class.class_id)
                || classes
                    .insert(class.type_name.clone(), class.class_id)
                    .is_some()
            {
                return Err(BoundaryError::Invalid("compatibility class namespace"));
            }
            if !macro_document_model::editor::is_supported_node_type(&class.type_name) {
                return Err(BoundaryError::Invalid(
                    "unsupported compatibility node class",
                ));
            }
        }
        // Resolve every registration before constructing the live editor.
        let mut prepared = compat_editor_builder(EditorMode::Headless, 0)
            .without_static_transforms()
            .without_reconciler_caches();
        if let Some(instances) = &instances {
            prepared = prepared.foreign_instance_hooks(instances.clone());
        }
        for name in classes.keys() {
            prepared = macro_document_model::editor::register_supported_node(prepared, name)?;
        }
        let prepared = prepared.build().map_err(|error| {
            BoundaryError::Model(lexical_model::Error::invariant(error.to_string()))
        })?;
        let known_hooks = lexical_model::ForeignHook::ALL
            .iter()
            .fold(0, |mask, hook| mask | hook.bit());
        for class in &registration.classes {
            let expected = prepared
                .registry()
                .get(&class.type_name)
                .ok_or(BoundaryError::Invalid("compatibility registration"))?;
            let kind = match expected.kind {
                lexical_model::NodeKind::Element => compat::ForeignNodeKind::Element,
                lexical_model::NodeKind::Text => compat::ForeignNodeKind::Text,
                lexical_model::NodeKind::Decorator => compat::ForeignNodeKind::Decorator,
                lexical_model::NodeKind::LineBreak => compat::ForeignNodeKind::LineBreak,
            };
            if class.kind != kind
                || class.hooks & !known_hooks != 0
                || class.ancestry.iter().any(|id| !ids.contains(id))
            {
                return Err(BoundaryError::Invalid("compatibility class descriptor"));
            }
        }
        drop(prepared);
        let capture = crate::telemetry::begin();
        let span = tracing::info_span!("editor.compat.create");
        let session = {
            let _entered = span.enter();
            config.surface = SurfaceConfig::Editor(EditorConfig {
                view_host,
                mode: if headless {
                    EditorMode::Headless
                } else {
                    EditorMode::ViewAttached
                },
                builder: Arc::new(move |mode, peer| {
                    let mut builder = compat_editor_builder(mode, peer)
                        .without_static_transforms()
                        .without_reconciler_caches()
                        .key_source(lexical_model::KeySource::Shared(keys.clone()))
                        .plugin(crate::compatibility::observer::Observer(receipts.clone()));
                    if let Some(instances) = &instances {
                        builder = builder.foreign_instance_hooks(instances.clone());
                    }
                    for name in classes.keys() {
                        // The same immutable registration set was resolved above.
                        builder =
                            macro_document_model::editor::register_supported_node(builder, name)
                                .expect("prevalidated compatibility class");
                    }
                    builder
                }),
                ..EditorConfig::default()
            });
            Session::Editor(Box::new(DocumentSession::new(config, now)?))
        };
        drop(span);
        Ok(Self {
            session,
            output: vec![],
            decorator_observer: Default::default(),
            wake: None,
            wall_origin: wall - mono,
            terminal: false,
            initial_telemetry: capture.finish(),
            constructor_clock: None,
            view_commands: None,
        })
    }
}
