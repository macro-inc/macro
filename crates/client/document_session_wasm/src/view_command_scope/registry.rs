use super::*;
fn registration(priority: CommandPriority) -> CommandRegistration {
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Enter),
        priority,
        placement: Placement::After,
    }
}
pub(super) fn priority(value: u8) -> Result<CommandPriority, Error> {
    match value {
        0 => Ok(CommandPriority::Editor),
        1 => Ok(CommandPriority::Low),
        2 => Ok(CommandPriority::Normal),
        3 => Ok(CommandPriority::High),
        4 => Ok(CommandPriority::Critical),
        _ => Err(Error::Invariant("view command priority")),
    }
}
impl Registry {
    pub(crate) fn new() -> Result<Arc<Self>, Error> {
        Self::with_host(Arc::new(host::WasmHost))
    }
    pub(super) fn with_host(host: Arc<dyn Host>) -> Result<Arc<Self>, Error> {
        Ok(Arc::new(Self {
            owner: Id::issue()?,
            host,
            state: Mutex::new(RegistryState {
                entries: vec![],
                epoch: 0,
                reports: vec![],
                failures: std::collections::VecDeque::new(),
                retired: std::collections::VecDeque::new(),
                issued: vec![],
                fault: None,
            }),
        }))
    }
    pub(super) fn lock(&self) -> Result<std::sync::MutexGuard<'_, RegistryState>, Error> {
        self.state
            .lock()
            .map_err(|_| Error::Invariant("view command registry poisoned"))
    }
    pub(crate) fn owner(&self) -> u64 {
        self.owner.raw()
    }
    pub(crate) fn rebind(
        &self,
        session: &mut document_session::DocumentSession<document_session::EditorSurface>,
    ) -> Result<(), Error> {
        let mut state = self.lock()?;
        if state
            .entries
            .iter()
            .all(|entry| session.has_command_listener(&entry.actual))
        {
            return Ok(());
        }
        let epoch = state
            .epoch
            .checked_add(1)
            .ok_or(Error::Invariant("view command binding epoch exhausted"))?;
        for entry in &mut state.entries {
            if !session.has_command_listener(&entry.actual) {
                entry.actual = session.register_command_listener(
                    registration(entry.priority),
                    entry.listener.clone(),
                );
            }
        }
        state.epoch = epoch;
        Ok(())
    }
    pub(crate) fn ensure_local(&self) -> Result<(), Error> {
        let state = self.lock()?;
        if state.fault.is_some()
            || !state.failures.is_empty()
            || !state.retired.is_empty()
            || !state.reports.is_empty()
        {
            return Err(Error::Invariant(
                "view command failure acknowledgement required",
            ));
        }
        Ok(())
    }
    pub(crate) fn register(
        self: &Arc<Self>,
        session: &mut document_session::DocumentSession<document_session::EditorSurface>,
        callback: u64,
        value: u8,
    ) -> Result<u64, Error> {
        self.ensure_local()?;
        self.rebind(session)?;
        self.insert(callback, priority(value)?, |registration, listener| {
            session.register_command_listener(registration, listener)
        })
    }
    pub(super) fn insert(
        self: &Arc<Self>,
        callback: u64,
        priority: CommandPriority,
        register: impl FnOnce(CommandRegistration, Arc<dyn CommandListener>) -> CommandListenerId,
    ) -> Result<u64, Error> {
        let callback =
            NonZeroU64::new(callback).ok_or(Error::Invariant("view callback identity zero"))?;
        let mut state = self.lock()?;
        if let Some(entry) = state
            .entries
            .iter()
            .find(|entry| entry.callback == callback && entry.priority == priority)
        {
            return Ok(entry.handle.raw());
        }
        let handle = Id::issue()?;
        let listener: Arc<dyn CommandListener> = Arc::new(Listener {
            registry: Arc::downgrade(self),
            callback,
        });
        let actual = register(registration(priority), listener.clone());
        state.entries.push(Entry {
            handle,
            callback,
            priority,
            listener,
            actual,
        });
        Ok(handle.raw())
    }
    pub(crate) fn unregister(
        &self,
        session: &mut document_session::DocumentSession<document_session::EditorSurface>,
        handle: u64,
    ) -> Result<(), Error> {
        self.remove(handle, |id| session.unregister_command_listener(id))
    }
    pub(super) fn remove(
        &self,
        handle: u64,
        unregister: impl FnOnce(&CommandListenerId),
    ) -> Result<(), Error> {
        let mut state = self.lock()?;
        if let Some(index) = state
            .entries
            .iter()
            .position(|entry| entry.handle.raw() == handle)
        {
            let entry = state.entries.remove(index);
            unregister(&entry.actual);
        }
        Ok(())
    }
    pub(crate) fn invoke<T>(
        self: &Arc<Self>,
        access: doc_sync_core::Access,
        body: impl FnOnce() -> T,
    ) -> Result<T, Error> {
        self.invoke_input(access, false, body)
    }
    pub(crate) fn invoke_control<T>(
        self: &Arc<Self>,
        access: doc_sync_core::Access,
        body: impl FnOnce() -> T,
    ) -> Result<T, Error> {
        self.invoke_input(access, true, body)
    }
    fn invoke_input<T>(
        self: &Arc<Self>,
        access: doc_sync_core::Access,
        control: bool,
        body: impl FnOnce() -> T,
    ) -> Result<T, Error> {
        if INVOCATION.is_set() {
            return Err(Error::Invariant("ordinary view invocation already active"));
        }
        let mut state = self.lock()?;
        let pending = state.fault.is_some()
            || !state.failures.is_empty()
            || !state.retired.is_empty()
            || !state.reports.is_empty();
        if pending && !control {
            return Err(Error::Invariant(
                "view command failure acknowledgement required",
            ));
        }
        for lease in state.issued.drain(..).filter_map(|weak| weak.upgrade()) {
            lease.store(false, Ordering::Relaxed);
        }
        while let Some(lease) = state.failures.pop_front() {
            lease.current.store(false, Ordering::Relaxed);
            state.retired.push_back(lease);
        }
        let epoch = state.epoch;
        drop(state);
        let id = match Id::issue() {
            Ok(id) => id,
            Err(_) if control => return Ok(body()), // Canonical control never depends on a new UI identity.
            Err(error) => return Err(error),
        };
        let invocation = Invocation {
            registry: self.clone(),
            id,
            epoch,
            access,
            allow_callbacks: !pending,
        };
        Ok(INVOCATION.set(&invocation, body))
    }
    pub(crate) fn take_failure(&self) -> Result<Option<ViewCommandFailure>, Error> {
        let mut state = self.lock()?;
        let lease = state
            .retired
            .pop_front()
            .or_else(|| state.failures.pop_front());
        if let Some(lease) = lease {
            state.issued.push(Arc::downgrade(&lease.current));
            return Ok(Some(lease));
        }
        if let Some(reason) = state.fault {
            return Err(Error::Invariant(reason));
        }
        Ok(None)
    }
    pub(crate) fn bind_output(&self, view: &[document_session::ViewEffect]) {
        // Actual typed errors from every Session path, including remote/restore.
        for (index, effect) in view.iter().enumerate() {
            if let Some(error) = failure::model_error(effect) {
                self.report(error, index);
            }
        }
        if let Ok(mut state) = self.lock() {
            let mut reports = std::mem::take(&mut state.reports);
            reports.sort_by_key(|report| report.view_index);
            if reports.is_empty() {
                return;
            }
            match failure::encode(&reports, view) {
                Ok(leases) => state.failures.extend(leases),
                Err(reason) => {
                    state.retired.extend(failure::retired(&reports));
                    state.fault = Some(reason);
                }
            }
        }
    }
    pub(crate) fn report(&self, error: &Error, view_index: usize) {
        if let Error::Extension(error) = error {
            if let Some(cause) = error.downcast_ref::<CallbackFailure>() {
                if cause.owner == self.owner && INVOCATION.is_set() {
                    let matches = INVOCATION.with(|current| {
                        current.id == cause.invocation && current.registry.owner == self.owner
                    });
                    if matches {
                        if let Ok(mut state) = self.lock() {
                            if state.reports.iter().any(|record| {
                                record.view_index == view_index && record.cause == *cause
                            }) {
                                return;
                            }
                            state.reports.push(failure::Report {
                                cause: *cause,
                                view_index,
                            });
                        }
                    }
                }
            }
        }
    }
}

impl document_session::ReportedModelErrorObserver for Registry {
    fn reported(&self, error: &Error, view_index: usize) {
        self.report(error, view_index);
    }
}
