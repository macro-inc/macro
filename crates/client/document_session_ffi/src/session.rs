//! Synchronous native session ownership; no mutex is held across host I/O.
use crate::*;
struct NativeHost<S: Surface> {
    session: DocumentSession<S>,
    last_mono: u64,
    clock: Arc<AtomicI64>,
    application: Option<FfiApplicationConfig>,
}
fn config(
    value: FfiSessionConfig,
    store_path: Option<String>,
    editor: bool,
    clock: Arc<AtomicI64>,
) -> Result<SessionConfig, FfiSessionError> {
    if store_path.is_some() {
        return Err(FfiSessionError::StoreNotConfigured);
    }
    if value.sync.chatter || value.sync.transport == TransportKind::Routed {
        return Err(invalid(
            "native sessions require direct/no transport and no chatter",
        ));
    }
    if !editor && value.application.is_some() {
        return Err(invalid("generic sessions do not accept editor presets"));
    }
    let mut editor_config = EditorConfig {
        mode: if value.headless {
            EditorMode::Headless
        } else {
            EditorMode::ViewAttached
        },
        view_host: ViewHost {
            engine: ViewEngine::Native,
            os: value.os,
        },
        ..EditorConfig::default()
    };
    if let Some(application) = &value.application {
        editor_config = application_editor_config(editor_config, clock, application.editor_type);
    }
    Ok(SessionConfig {
        sync: value.sync,
        peer_ids: value.peers,
        peer_range: value.peer_range,
        surface: if editor {
            SurfaceConfig::Editor(editor_config)
        } else {
            SurfaceConfig::Generic(GenericConfig {
                roots: value.observed,
            })
        },
    })
}
impl<S: Surface> NativeHost<S> {
    fn handle(&mut self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError> {
        self.handle_native(now, input.native())
    }
    fn handle_native(
        &mut self,
        now: FfiNow,
        input: SessionInput,
    ) -> Result<FfiOutput, FfiSessionError> {
        if now.mono_ms < self.last_mono {
            return Err(invalid("monotonic clock decreased"));
        }
        self.last_mono = now.mono_ms;
        self.clock.store(now.wall_ms, Ordering::Relaxed);
        convert::output(self.session.handle(now.into(), input))
    }
}
/// Native-view editor. Calls are serialized across UI and sync threads.
#[derive(uniffi::Object)]
pub struct NativeEditorSession {
    inner: Mutex<NativeHost<EditorSurface>>,
}
#[uniffi::export]
impl NativeEditorSession {
    /// Construct an unstarted editor; native view policy is always selected.
    #[uniffi::constructor]
    pub fn new(
        config_value: FfiSessionConfig,
        store_path: Option<String>,
        now: FfiNow,
    ) -> Result<Arc<Self>, FfiSessionError> {
        let last_mono = now.mono_ms;
        let clock = Arc::new(AtomicI64::new(now.wall_ms));
        let application = config_value.application.clone();
        let session = DocumentSession::new(
            config(config_value, store_path, true, clock.clone())?,
            now.into(),
        )
        .map_err(invalid)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(NativeHost {
                session,
                last_mono,
                clock,
                application,
            }),
        }))
    }
    /// Observe current effective access; later inputs still require normal admission.
    pub fn effective_access(&self) -> Result<Access, FfiSessionError> {
        Ok(lock(&self.inner)?.session.effective_access())
    }
    /// Admit exactly one input and return every owned host effect. Never performs I/O.
    pub fn handle(&self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError> {
        lock(&self.inner)?.handle(now, input)
    }
    /// Admit a command from the shared application command catalog.
    pub fn application_command(
        &self,
        now: FfiNow,
        name: String,
        payload: JsonValue,
        generation: u32,
        selection: ViewSelection,
    ) -> Result<FfiOutput, FfiSessionError> {
        let mut host = lock(&self.inner)?;
        if host.application.is_none() {
            return Err(invalid(
                "application command requires an application preset",
            ));
        }
        let command = macro_document_model::surface::decode_command(
            &name,
            &serde_json::to_string(&payload).map_err(invalid)?,
            generation,
            None,
        )
        .map_err(invalid)?
        .ok_or_else(|| invalid("unknown application command"))?;
        host.handle_native(
            now,
            SessionInput::Editor(Input::Command { command, selection }),
        )
    }
    /// Resolve one live snippet placeholder using shared source/target Markdown policy.
    /// Source is the full structured serialized editor state, including its root.
    /// None clears a failed fetch. Empty/malformed fetched states follow the
    /// existing source extractor retention policy; no host I/O runs here.
    pub fn resolve_snippet(
        &self,
        now: FfiNow,
        key: NodeKey,
        await_id: String,
        source: Option<JsonValue>,
    ) -> Result<FfiOutput, FfiSessionError> {
        let mut host = lock(&self.inner)?;
        let preset = host
            .application
            .as_ref()
            .ok_or_else(|| invalid("snippet resolution requires an application preset"))?
            .editor_type;
        let source = source
            .map(serde_json::from_value)
            .transpose()
            .map_err(invalid)?;
        let command = macro_document_model::plugins_group_a::menu::resolve_snippet_source(
            key, await_id, source, preset,
        );
        host.handle_native(
            now,
            SessionInput::Editor(Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            }),
        )
    }
    /// Query the shared application catalog without changing model state.
    pub fn application_query(
        &self,
        name: String,
        payload: JsonValue,
        generation: u32,
    ) -> Result<JsonValue, FfiSessionError> {
        let host = lock(&self.inner)?;
        if host.application.is_none() {
            return Err(invalid("application query requires an application preset"));
        }
        macro_document_model::surface::query(
            &name,
            &payload,
            generation,
            host.session.surface().state(),
        )
        .map_err(invalid)?
        .ok_or_else(|| invalid("unknown application query"))
    }
    /// Read cached native root text.
    pub fn text_content(&self) -> Result<String, FfiSessionError> {
        Ok(lock(&self.inner)?
            .session
            .surface()
            .state()
            .root_text_content()
            .to_string())
    }
    /// Export portable native Markdown with the selected indentation policy.
    pub fn markdown(&self, flavor: FfiMarkdownFlavor) -> Result<String, FfiSessionError> {
        let host = lock(&self.inner)?;
        query::markdown(&host.session, host.application.as_ref(), flavor, false)
    }
    /// Perform one typed native bulk query.
    pub fn query(&self, request: FfiQuery) -> Result<FfiQueryReply, FfiSessionError> {
        let host = lock(&self.inner)?;
        query::query(&host.session, host.application.as_ref(), request)
    }
}
/// Native generic collaborative document with the same lifecycle and host effects.
#[derive(uniffi::Object)]
pub struct NativeDocSession {
    inner: Mutex<NativeHost<GenericSurface>>,
}
#[uniffi::export]
impl NativeDocSession {
    /// Construct an unstarted generic session. No chatter or browser runtime is required.
    #[uniffi::constructor]
    pub fn new(
        config_value: FfiSessionConfig,
        store_path: Option<String>,
        now: FfiNow,
    ) -> Result<Arc<Self>, FfiSessionError> {
        let last_mono = now.mono_ms;
        let clock = Arc::new(AtomicI64::new(now.wall_ms));
        let application = None;
        let session = DocumentSession::new(
            config(config_value, store_path, false, clock.clone())?,
            now.into(),
        )
        .map_err(invalid)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(NativeHost {
                session,
                last_mono,
                clock,
                application,
            }),
        }))
    }
    /// Observe current effective access; later inputs still require normal admission.
    pub fn effective_access(&self) -> Result<Access, FfiSessionError> {
        Ok(lock(&self.inner)?.session.effective_access())
    }
    /// Admit one input; storage completions re-enter as later calls from the host.
    pub fn handle(&self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError> {
        lock(&self.inner)?.handle(now, input)
    }
    /// Read a complete typed native value at an attached container path.
    pub fn read(&self, path: ContainerPath) -> Result<DocValue, FfiSessionError> {
        lock(&self.inner)?.session.read(&path).map_err(invalid)
    }
}
