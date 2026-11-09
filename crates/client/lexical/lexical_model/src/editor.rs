//! Editor ownership and atomic update entry points.
use crate::*;
use std::sync::Arc;
#[cfg(feature = "foreign-nodes")]
mod conformance;
/// Whether the model serves a view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorMode {
    /// No DOM or attached view.
    Headless,
    /// A view consumes committed changes.
    ViewAttached,
}
/// Owns the current immutable snapshot and a non-rollback key allocator.
pub struct Editor {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_publication_observer: Option<Arc<dyn ForeignPublicationObserver>>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_instances: Arc<crate::foreign::instances::ForeignInstances>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_runtime: crate::foreign::runtime::ForeignRuntime,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) suspend_owner: Arc<()>,
    #[cfg(not(feature = "foreign-nodes"))]
    pub(crate) suspend_owner: std::sync::OnceLock<Arc<()>>,
    pub(crate) suspend_version: CommitId,
    pub(crate) extensions: crate::extension::Extensions,
    pub(crate) plugins: Vec<Arc<dyn Plugin>>,
    pub(crate) listeners: crate::plugin::Listeners,
    pub(crate) listener_table: ListenerTable,
    pub(crate) initial_commits: Vec<Commit>,
    pub(crate) initial_diff: Option<Diff>,
    pub(crate) state: EditorState,
    pub(crate) keys: SharedKeyCounter,
    mode: EditorMode,
    pub(crate) carried_tags: TagSet,
    pub(crate) view_host: ViewHost,
    pub(crate) composition_key: Option<NodeKey>,
}
impl Editor {
    pub(crate) fn new(
        registry: Arc<Registry>,
        mode: EditorMode,
        source: KeySource,
        view_host: ViewHost,
    ) -> Result<Self, Error> {
        let state = EditorState::empty(registry)?;
        #[cfg(feature = "foreign-nodes")]
        let (state, suspend_owner, foreign_instances) = {
            let owner = Arc::new(());
            let instances = Arc::new(crate::foreign::instances::ForeignInstances::for_owner(
                owner.clone(),
            ));
            let mut state = state;
            state.foreign_instances = instances.clone();
            (state, owner, instances)
        };
        Ok(Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_publication_observer: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_runtime: Default::default(),
            #[cfg(feature = "foreign-nodes")]
            suspend_owner,
            #[cfg(not(feature = "foreign-nodes"))]
            suspend_owner: std::sync::OnceLock::new(),
            #[cfg(feature = "foreign-nodes")]
            foreign_instances,
            suspend_version: CommitId(0),
            extensions: Default::default(),
            plugins: vec![],
            listeners: Default::default(),
            listener_table: Default::default(),
            initial_commits: vec![],
            initial_diff: None,
            state,
            keys: match source {
                KeySource::PerEditor => SharedKeyCounter::new(),
                KeySource::Shared(keys) => keys,
            },
            mode,
            view_host,
            composition_key: None,
            carried_tags: TagSet::default(),
        })
    }
    /// Configure an editor with an explicit mode.
    pub fn builder(mode: EditorMode) -> EditorBuilder {
        EditorBuilder::new(mode)
    }
    /// Create an empty dev-only peer sharing this registry and key allocator.
    /// Tier C keeps a separate attached view, like the upstream DOM oracle.
    #[cfg(feature = "foreign-nodes")]
    pub fn create_conformance_peer(&self, mode: EditorMode) -> Result<Self, Error> {
        Self::new(
            self.state.registry.clone(),
            mode,
            KeySource::Shared(self.keys.clone()),
            self.view_host,
        )
    }

    /// Current committed state.
    pub fn state(&self) -> &EditorState {
        &self.state
    }
    /// Immutable registered type configuration.
    pub fn registry(&self) -> &Arc<Registry> {
        &self.state.registry
    }
    /// Configured view mode.
    pub fn mode(&self) -> EditorMode {
        self.mode
    }
    /// Advance the key generation without changing existing keys.
    pub fn reset_key_counter(&self) -> Result<(), Error> {
        if self.state.node_count() > 1 {
            return Err(Error::KeyResetWithNodes);
        }
        self.keys.reset()
    }
    /// Begin an update; dropping it rolls back its nodes and property changes.
    pub fn transaction(&mut self) -> Transaction<'_> {
        Transaction::new(self)
    }
    /// Begin an update with explicit options.
    pub fn transaction_with(&mut self, options: UpdateOptions) -> Transaction<'_> {
        let mut tx = self.transaction();
        for tag in options.tags.iter() {
            tx.add_tag(tag.clone());
        }
        tx.options.skip_transforms = options.skip_transforms;
        tx
    }
    /// Run an update with explicit processing options.
    pub fn update_with<ValueType>(
        &mut self,
        options: UpdateOptions,
        body: impl FnOnce(&mut Transaction<'_>) -> Result<ValueType, Error>,
    ) -> Result<(ValueType, Commit), Error> {
        let mut tx = self.transaction_with(options);
        let value = body(&mut tx)?;
        let commit = tx.commit()?;
        Ok((value, self.run_after_commit(commit)))
    }
    /// Install a snapshot from this registry without transforming its contents.
    pub fn set_editor_state(&mut self, state: EditorState, tags: TagSet) -> Result<Commit, Error> {
        let mut tx = self.transaction();
        tx.install_state(state, tags)?;
        let commit = tx.commit()?;
        Ok(self.run_after_commit(commit))
    }
    /// Run an update using the caller's error type.
    pub fn try_update<ValueType, Failure: From<Error>>(
        &mut self,
        options: UpdateOptions,
        body: impl FnOnce(&mut Transaction<'_>) -> Result<ValueType, Failure>,
    ) -> Result<(ValueType, Commit), Failure> {
        let mut tx = self.transaction_with(options);
        let value = body(&mut tx)?;
        let commit = tx.commit()?;
        Ok((value, self.run_after_commit(commit)))
    }
    /// Run an atomic update and publish its state on success.
    /// s2: UPD-01, UPD-05
    pub fn update<ValueType>(
        &mut self,
        body: impl FnOnce(&mut Transaction<'_>) -> Result<ValueType, Error>,
    ) -> Result<(ValueType, Commit), Error> {
        let mut tx = self.transaction();
        let value = body(&mut tx)?;
        let commit = tx.commit()?;
        Ok((value, self.run_after_commit(commit)))
    }
}
/// Browser or native view engine used for platform-specific input policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewEngine {
    /// Chromium-based view.
    Chromium,
    /// Gecko-based view.
    Firefox,
    /// Apple WebKit view.
    AppleWebKit,
    /// Native view without a browser engine.
    Native,
}
/// Host operating-system family used by input policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewOs {
    /// Desktop Apple platform.
    Apple,
    /// iOS platform.
    Ios,
    /// Android platform.
    Android,
    /// Other platform.
    Other,
}
/// Immutable host context; headless editors use a neutral configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ViewHost {
    /// Rendering engine.
    pub engine: ViewEngine,
    /// Operating-system family.
    pub os: ViewOs,
}
impl ViewHost {
    /// Neutral headless configuration.
    pub const HEADLESS: Self = Self {
        engine: ViewEngine::Chromium,
        os: ViewOs::Other,
    };
}
