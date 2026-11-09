//! Synchronous native session ownership; no mutex is held across host I/O.
use crate::*;
struct NativeHost<S: Surface> {
    session: DocumentSession<S>,
    last_mono: u64,
}
fn config(
    value: FfiSessionConfig,
    store_path: Option<String>,
    editor: bool,
) -> Result<SessionConfig, FfiSessionError> {
    if store_path.is_some() {
        return Err(FfiSessionError::StoreNotConfigured);
    }
    if value.sync.chatter || value.sync.transport == TransportKind::Routed {
        return Err(invalid(
            "native sessions require direct/no transport and no chatter",
        ));
    }
    Ok(SessionConfig {
        sync: value.sync,
        peer_ids: value.peers,
        peer_range: value.peer_range,
        surface: if editor {
            SurfaceConfig::Editor(EditorConfig {
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
            })
        } else {
            SurfaceConfig::Generic(GenericConfig {
                roots: value.observed,
            })
        },
    })
}
impl<S: Surface> NativeHost<S> {
    fn handle(&mut self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError> {
        if now.mono_ms < self.last_mono {
            return Err(invalid("monotonic clock decreased"));
        }
        self.last_mono = now.mono_ms;
        convert::output(self.session.handle(now.into(), input.native()))
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
        let session = DocumentSession::new(config(config_value, store_path, true)?, now.into())
            .map_err(invalid)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(NativeHost { session, last_mono }),
        }))
    }
    /// Admit exactly one input and return every owned host effect. Never performs I/O.
    pub fn handle(&self, now: FfiNow, input: FfiInput) -> Result<FfiOutput, FfiSessionError> {
        lock(&self.inner)?.handle(now, input)
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
        markdown(host.session.surface().state(), flavor)
    }
    /// Perform one typed native bulk query.
    pub fn query(&self, request: FfiQuery) -> Result<FfiQueryReply, FfiSessionError> {
        let host = lock(&self.inner)?;
        query::query(&host.session, request)
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
        let session = DocumentSession::new(config(config_value, store_path, false)?, now.into())
            .map_err(invalid)?;
        Ok(Arc::new(Self {
            inner: Mutex::new(NativeHost { session, last_mono }),
        }))
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
