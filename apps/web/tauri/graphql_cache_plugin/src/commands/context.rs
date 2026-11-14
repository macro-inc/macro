//! Shared native state and permission admission extracted without changing IPC keys.

use crate::{CacheState, engine::AuthorityAdmission};
use tauri::{
    Runtime, State,
    ipc::{CommandArg, CommandItem, InvokeError},
};

/// Managed cache state and the command's explicit permission-generation claim.
pub struct CacheCommand<'a> {
    pub(super) state: State<'a, CacheState>,
    pub(super) authority: Option<AuthorityAdmission>,
}

impl<'de, R: Runtime> CommandArg<'de, R> for CacheCommand<'de> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        // Delegate both fields to Tauri so existing top-level argument names,
        // missing-authority handling, and malformed-argument errors stay intact.
        let state = State::from_command(CommandItem {
            key: "state",
            ..command
        })?;
        let authority = Option::<AuthorityAdmission>::from_command(CommandItem {
            key: "authority",
            ..command
        })?;
        Ok(Self { state, authority })
    }
}
