//! Target-independent consuming lifecycle for the worker-local adapter.

use std::fmt;

#[cfg(test)]
mod test;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct OwnerId(u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct SessionId(u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct HandleId(u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct CloseToken(u64);

impl OwnerId {
    #[cfg(test)]
    pub(crate) fn get(self) -> u64 {
        self.0
    }
}

impl SessionId {
    #[cfg(test)]
    pub(crate) fn get(self) -> u64 {
        self.0
    }
}

impl HandleId {
    #[cfg(test)]
    pub(crate) fn get(self) -> u64 {
        self.0
    }
}

impl CloseToken {
    #[cfg(test)]
    pub(crate) fn get(self) -> u64 {
        self.0
    }

    #[cfg(test)]
    pub(crate) fn from_raw(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum FileRole {
    Main,
    Wal,
}

impl FileRole {
    pub(crate) const ALL: [Self; 2] = [Self::Main, Self::Wal];

    pub(crate) const fn index(self) -> usize {
        match self {
            Self::Main => 0,
            Self::Wal => 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Paths {
    main: String,
    wal: String,
}

impl Paths {
    pub(crate) fn new(main: String, wal: String) -> Self {
        Self { main, wal }
    }

    pub(crate) fn get(&self, role: FileRole) -> &str {
        match role {
            FileRole::Main => &self.main,
            FileRole::Wal => &self.wal,
        }
    }

    pub(crate) fn role_for(&self, path: &str) -> Option<FileRole> {
        FileRole::ALL
            .into_iter()
            .find(|role| self.get(*role) == path)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StateErrorKind {
    Ownership,
    Session,
    Reentrant,
    ActiveReferences,
    Path,
    Flags,
    Registration,
    Token,
    Exhausted,
    Poisoned,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct StateError {
    pub(crate) kind: StateErrorKind,
    pub(crate) message: &'static str,
}

impl StateError {
    const fn new(kind: StateErrorKind, message: &'static str) -> Self {
        Self { kind, message }
    }
}

impl fmt::Display for StateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ActiveKind {
    Ready,
    Connected,
    ConnectionClosed,
    ResetOnly,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Phase {
    Unowned,
    Idle {
        owner: OwnerId,
    },
    Opening {
        owner: OwnerId,
        session: SessionId,
        paths: Paths,
        handles: [Option<HandleId>; 2],
    },
    Active {
        owner: OwnerId,
        session: SessionId,
        paths: Paths,
        handles: [HandleId; 2],
        kind: ActiveKind,
        operation_active: bool,
    },
    Closing {
        owner: OwnerId,
        session: SessionId,
        paths: Paths,
    },
    Closed {
        owner: OwnerId,
        token: CloseToken,
        paths: Paths,
    },
    Resetting {
        owner: OwnerId,
        token: CloseToken,
        paths: Paths,
    },
    Wiping {
        owner: OwnerId,
        paths: Paths,
    },
    Poisoned {
        owner: OwnerId,
        reason: String,
    },
}

#[derive(Debug)]
pub(crate) struct Machine {
    next_owner: u64,
    next_session: u64,
    next_handle: u64,
    next_close_token: u64,
    phase: Phase,
}

impl Default for Machine {
    fn default() -> Self {
        Self {
            next_owner: 0,
            next_session: 0,
            next_handle: 0,
            next_close_token: 0,
            phase: Phase::Unowned,
        }
    }
}

impl Machine {
    pub(crate) fn claim_owner(&mut self) -> Result<OwnerId, StateError> {
        if matches!(self.phase, Phase::Poisoned { .. }) {
            return Err(poisoned());
        }
        if self.phase != Phase::Unowned {
            return Err(StateError::new(
                StateErrorKind::Ownership,
                "worker-local OPFS registry already has an owner",
            ));
        }
        self.next_owner = next_id(self.next_owner, "owner ID space exhausted")?;
        let owner = OwnerId(self.next_owner);
        self.phase = Phase::Idle { owner };
        Ok(owner)
    }

    pub(crate) fn release_owner(&mut self, owner: OwnerId) -> Result<(), StateError> {
        match self.phase {
            Phase::Idle { owner: current } if current == owner => {
                self.phase = Phase::Unowned;
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Ownership,
                "owner release requires the matching idle owner",
            )),
        }
    }

    pub(crate) fn start_open(
        &mut self,
        owner: OwnerId,
        paths: Paths,
    ) -> Result<SessionId, StateError> {
        match self.phase {
            Phase::Idle { owner: current } if current == owner => {}
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Ownership,
                    "session open requires the matching idle owner",
                ));
            }
        }
        self.next_session = next_id(self.next_session, "session ID space exhausted")?;
        let session = SessionId(self.next_session);
        self.phase = Phase::Opening {
            owner,
            session,
            paths,
            handles: [None, None],
        };
        Ok(session)
    }

    pub(crate) fn register(
        &mut self,
        owner: OwnerId,
        session: SessionId,
        role: FileRole,
    ) -> Result<HandleId, StateError> {
        let handles = match &mut self.phase {
            Phase::Opening {
                owner: current_owner,
                session: current_session,
                handles,
                ..
            } if *current_owner == owner && *current_session == session => handles,
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "handle registration does not match the opening session",
                ));
            }
        };
        if handles[role.index()].is_some() {
            return Err(StateError::new(
                StateErrorKind::Registration,
                "an approved path was registered twice",
            ));
        }
        self.next_handle = next_id(self.next_handle, "handle ID space exhausted")?;
        let handle = HandleId(self.next_handle);
        handles[role.index()] = Some(handle);
        Ok(handle)
    }

    pub(crate) fn activate(
        &mut self,
        owner: OwnerId,
        session: SessionId,
        reset_only: bool,
    ) -> Result<Paths, StateError> {
        let (paths, handles) = match &self.phase {
            Phase::Opening {
                owner: current_owner,
                session: current_session,
                paths,
                handles: [Some(main), Some(wal)],
            } if *current_owner == owner && *current_session == session => {
                (paths.clone(), [*main, *wal])
            }
            Phase::Opening { .. } => {
                return Err(StateError::new(
                    StateErrorKind::Registration,
                    "activation requires both approved paths",
                ));
            }
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "activation does not match the opening session",
                ));
            }
        };
        self.phase = Phase::Active {
            owner,
            session,
            paths: paths.clone(),
            handles,
            kind: if reset_only {
                ActiveKind::ResetOnly
            } else {
                ActiveKind::Ready
            },
            operation_active: false,
        };
        Ok(paths)
    }

    pub(crate) fn bind_connection(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<(), StateError> {
        match &mut self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                kind,
                operation_active: false,
                ..
            } if *current_owner == owner
                && *current_session == session
                && *kind == ActiveKind::Ready =>
            {
                *kind = ActiveKind::Connected;
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Session,
                "connection binding requires the matching ready session",
            )),
        }
    }

    pub(crate) fn record_connection_close(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<(), StateError> {
        match &mut self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                kind,
                operation_active: false,
                ..
            } if *current_owner == owner
                && *current_session == session
                && *kind == ActiveKind::Connected =>
            {
                *kind = ActiveKind::ConnectionClosed;
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::ActiveReferences,
                "connection close proof requires the matching connected session",
            )),
        }
    }

    pub(crate) fn abort_open(
        &mut self,
        owner: OwnerId,
        session: SessionId,
        cleanup_certain: bool,
        reason: String,
    ) -> Result<(), StateError> {
        match self.phase {
            Phase::Opening {
                owner: current_owner,
                session: current_session,
                ..
            } if current_owner == owner && current_session == session => {}
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "opening cleanup does not match the opening session",
                ));
            }
        }
        self.phase = if cleanup_certain {
            Phase::Idle { owner }
        } else {
            Phase::Poisoned { owner, reason }
        };
        Ok(())
    }

    pub(crate) fn validate_session(
        &self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<(), StateError> {
        match self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                kind: ActiveKind::Ready | ActiveKind::Connected,
                ..
            } if current_owner == owner && current_session == session => Ok(()),
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Session,
                "stale or mismatched owner/session ID",
            )),
        }
    }

    pub(crate) fn validate_open(
        &self,
        owner: OwnerId,
        session: SessionId,
        path: &str,
        read_only: bool,
        no_lock: bool,
        direct: bool,
    ) -> Result<HandleId, StateError> {
        let (paths, handles) = match &self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                paths,
                handles,
                kind: ActiveKind::Ready | ActiveKind::Connected,
                ..
            } if *current_owner == owner && *current_session == session => (paths, handles),
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "open_file used a stale or mismatched session",
                ));
            }
        };
        let role = paths.role_for(path).ok_or_else(|| {
            StateError::new(
                StateErrorKind::Path,
                "open_file path was not pre-registered",
            )
        })?;
        if read_only {
            return Err(StateError::new(
                StateErrorKind::Flags,
                "read-only open is not approved for the writable cache session",
            ));
        }
        let expected_direct = role == FileRole::Main;
        if direct != expected_direct {
            return Err(StateError::new(
                StateErrorKind::Flags,
                "open_file direct mode does not match the approved main/WAL mode",
            ));
        }
        if no_lock && role != FileRole::Wal {
            return Err(StateError::new(
                StateErrorKind::Flags,
                "NoLock is approved only for the WAL path",
            ));
        }
        Ok(handles[role.index()])
    }

    pub(crate) fn validate_path(
        &self,
        owner: OwnerId,
        session: SessionId,
        path: &str,
    ) -> Result<(), StateError> {
        let paths = match &self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                paths,
                kind: ActiveKind::Ready | ActiveKind::Connected,
                ..
            } if *current_owner == owner && *current_session == session => paths,
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "path lookup used a stale or mismatched session",
                ));
            }
        };
        if paths.role_for(path).is_some() {
            Ok(())
        } else {
            Err(StateError::new(
                StateErrorKind::Path,
                "path was not pre-registered",
            ))
        }
    }

    pub(crate) fn begin_operation(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<(), StateError> {
        match &mut self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                kind: ActiveKind::Ready | ActiveKind::Connected,
                operation_active,
                ..
            } if *current_owner == owner && *current_session == session => {
                if *operation_active {
                    return Err(StateError::new(
                        StateErrorKind::Reentrant,
                        "reentrant OPFS operation rejected",
                    ));
                }
                *operation_active = true;
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Session,
                "operation used a stale or mismatched session",
            )),
        }
    }

    pub(crate) fn end_operation(&mut self, owner: OwnerId, session: SessionId) {
        if let Phase::Active {
            owner: current_owner,
            session: current_session,
            operation_active,
            ..
        } = &mut self.phase
            && *current_owner == owner
            && *current_session == session
        {
            *operation_active = false;
        }
    }

    pub(crate) fn start_close(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<[HandleId; 2], StateError> {
        self.start_close_with_kind(owner, session, ActiveKind::ConnectionClosed)
    }

    pub(crate) fn start_reset_only_close(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<[HandleId; 2], StateError> {
        self.start_close_with_kind(owner, session, ActiveKind::ResetOnly)
    }

    fn start_close_with_kind(
        &mut self,
        owner: OwnerId,
        session: SessionId,
        required_kind: ActiveKind,
    ) -> Result<[HandleId; 2], StateError> {
        let (paths, handles) = match &self.phase {
            Phase::Active {
                owner: current_owner,
                session: current_session,
                paths,
                handles,
                kind,
                operation_active: false,
            } if *current_owner == owner
                && *current_session == session
                && *kind == required_kind =>
            {
                (paths.clone(), *handles)
            }
            Phase::Active {
                owner: current_owner,
                session: current_session,
                operation_active: true,
                ..
            } if *current_owner == owner && *current_session == session => {
                return Err(StateError::new(
                    StateErrorKind::ActiveReferences,
                    "cannot close while an OPFS operation is active",
                ));
            }
            Phase::Active {
                owner: current_owner,
                session: current_session,
                ..
            } if *current_owner == owner && *current_session == session => {
                return Err(StateError::new(
                    StateErrorKind::ActiveReferences,
                    "close requires the matching connection-close or reset-only proof",
                ));
            }
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "close used a stale or mismatched session",
                ));
            }
        };
        self.phase = Phase::Closing {
            owner,
            session,
            paths: paths.clone(),
        };
        Ok(handles)
    }

    pub(crate) fn finish_close(
        &mut self,
        owner: OwnerId,
        session: SessionId,
    ) -> Result<CloseToken, StateError> {
        let paths = match &self.phase {
            Phase::Closing {
                owner: current_owner,
                session: current_session,
                paths,
            } if *current_owner == owner && *current_session == session => paths.clone(),
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Session,
                    "close completion did not match the closing session",
                ));
            }
        };
        self.next_close_token = next_id(self.next_close_token, "close token space exhausted")?;
        let token = CloseToken(self.next_close_token);
        self.phase = Phase::Closed {
            owner,
            token,
            paths,
        };
        Ok(token)
    }

    pub(crate) fn preserve(&mut self, owner: OwnerId, token: CloseToken) -> Result<(), StateError> {
        match self.phase {
            Phase::Closed {
                owner: current_owner,
                token: current_token,
                ..
            } if current_owner == owner && current_token == token => {
                self.phase = Phase::Idle { owner };
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Token,
                "preserve requires the matching one-use close token",
            )),
        }
    }

    pub(crate) fn start_reset(
        &mut self,
        owner: OwnerId,
        token: CloseToken,
    ) -> Result<Paths, StateError> {
        let paths = match &self.phase {
            Phase::Closed {
                owner: current_owner,
                token: current_token,
                paths,
            } if *current_owner == owner && *current_token == token => paths.clone(),
            Phase::Poisoned { .. } => return Err(poisoned()),
            _ => {
                return Err(StateError::new(
                    StateErrorKind::Token,
                    "reset requires the matching one-use close token",
                ));
            }
        };
        self.phase = Phase::Resetting {
            owner,
            token,
            paths: paths.clone(),
        };
        Ok(paths)
    }

    pub(crate) fn finish_reset(
        &mut self,
        owner: OwnerId,
        token: CloseToken,
    ) -> Result<(), StateError> {
        match self.phase {
            Phase::Resetting {
                owner: current_owner,
                token: current_token,
                ..
            } if current_owner == owner && current_token == token => {
                self.phase = Phase::Idle { owner };
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Token,
                "reset completion did not match the consumed close token",
            )),
        }
    }

    pub(crate) fn start_wipe(&mut self, owner: OwnerId, paths: Paths) -> Result<(), StateError> {
        match self.phase {
            Phase::Idle { owner: current } if current == owner => {
                self.phase = Phase::Wiping { owner, paths };
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Ownership,
                "recovery wipe requires the matching idle owner",
            )),
        }
    }

    pub(crate) fn finish_wipe(&mut self, owner: OwnerId) -> Result<(), StateError> {
        match self.phase {
            Phase::Wiping { owner: current, .. } if current == owner => {
                self.phase = Phase::Idle { owner };
                Ok(())
            }
            Phase::Poisoned { .. } => Err(poisoned()),
            _ => Err(StateError::new(
                StateErrorKind::Ownership,
                "recovery wipe completion requires the matching wiping owner",
            )),
        }
    }

    pub(crate) fn poison(&mut self, owner: OwnerId, reason: String) -> Result<(), StateError> {
        if matches!(self.phase, Phase::Poisoned { owner: current, .. } if current == owner) {
            return Ok(());
        }
        let current_owner = match self.phase {
            Phase::Unowned => None,
            Phase::Idle { owner }
            | Phase::Opening { owner, .. }
            | Phase::Active { owner, .. }
            | Phase::Closing { owner, .. }
            | Phase::Closed { owner, .. }
            | Phase::Resetting { owner, .. }
            | Phase::Wiping { owner, .. }
            | Phase::Poisoned { owner, .. } => Some(owner),
        };
        if current_owner != Some(owner) {
            return Err(StateError::new(
                StateErrorKind::Ownership,
                "stale owner cannot poison the current OPFS lifecycle",
            ));
        }
        self.phase = Phase::Poisoned { owner, reason };
        Ok(())
    }

    pub(crate) fn is_idle_owner(&self, owner: OwnerId) -> bool {
        matches!(self.phase, Phase::Idle { owner: current } if current == owner)
    }

    #[cfg(test)]
    pub(crate) fn phase_label(&self) -> &'static str {
        match self.phase {
            Phase::Unowned => "unowned",
            Phase::Idle { .. } => "idle",
            Phase::Opening { .. } => "opening",
            Phase::Active { .. } => "active",
            Phase::Closing { .. } => "closing",
            Phase::Closed { .. } => "closed",
            Phase::Resetting { .. } => "resetting",
            Phase::Wiping { .. } => "wiping",
            Phase::Poisoned { .. } => "poisoned",
        }
    }

    #[cfg(all(test, target_arch = "wasm32"))]
    pub(crate) fn is_poisoned(&self) -> bool {
        matches!(self.phase, Phase::Poisoned { .. })
    }

    #[cfg(test)]
    pub(crate) fn poison_reason(&self) -> Option<&str> {
        match &self.phase {
            Phase::Poisoned { reason, .. } => Some(reason),
            _ => None,
        }
    }
}

fn next_id(value: u64, message: &'static str) -> Result<u64, StateError> {
    value
        .checked_add(1)
        .ok_or_else(|| StateError::new(StateErrorKind::Exhausted, message))
}

fn poisoned() -> StateError {
    StateError::new(
        StateErrorKind::Poisoned,
        "worker-local OPFS session is poisoned",
    )
}
