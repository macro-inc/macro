//! Editor ownership and atomic update entry points.
use crate::*;
use std::sync::Arc;
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
    pub(crate) state: EditorState,
    pub(crate) keys: SharedKeyCounter,
    mode: EditorMode,
    pub(crate) carried_tags: TagSet,
    pub(crate) commit_counter: u64,
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
        Ok(Self {
            state: EditorState::empty(registry)?,
            keys: match source {
                KeySource::PerEditor => SharedKeyCounter::new(),
                KeySource::Shared(keys) => keys,
            },
            mode,
            view_host,
            composition_key: None,
            carried_tags: TagSet::default(),
            commit_counter: 0,
        })
    }
    /// Configure an editor with an explicit mode.
    pub fn builder(mode: EditorMode) -> EditorBuilder {
        EditorBuilder::new(mode)
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
        Ok((value, tx.commit()?))
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
        Ok((value, commit))
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
        engine: ViewEngine::Native,
        os: ViewOs::Other,
    };
}
