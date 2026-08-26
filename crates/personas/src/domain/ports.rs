//! Ports: the service trait inbound adapters call, and the repository trait
//! outbound adapters implement.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::Result;
use crate::domain::models::{BotId, CreatePersonaRequest, PatchPersonaRequest, Persona};

pub use crate::domain::error::PersonaError;

/// Persona use cases, called by inbound adapters.
pub trait PersonaService: Send + Sync + 'static {
    /// Create a persona owned by `caller`.
    fn create_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreatePersonaRequest,
    ) -> impl Future<Output = Result<Persona>> + Send;

    /// List the personas `caller` owns.
    fn list_personas(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Persona>>> + Send;

    /// Get one of `caller`'s personas.
    fn get_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        id: BotId,
    ) -> impl Future<Output = Result<Persona>> + Send;

    /// Edit one of `caller`'s personas.
    fn patch_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        id: BotId,
        req: PatchPersonaRequest,
    ) -> impl Future<Output = Result<Persona>> + Send;

    /// Delete one of `caller`'s personas.
    fn delete_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        id: BotId,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// Persona persistence, implemented by outbound adapters.
///
/// Implementations map storage failures to [`PersonaError`]; in particular a
/// handle uniqueness violation becomes [`PersonaError::HandleTaken`].
pub trait PersonaRepo: Send + Sync + 'static {
    /// Insert a persona owned by `owner` and return it.
    fn create_persona(
        &self,
        id: BotId,
        owner: MacroUserIdStr<'static>,
        req: CreatePersonaRequest,
    ) -> impl Future<Output = Result<Persona>> + Send;

    /// All live personas owned by `owner`, newest first.
    fn list_personas(
        &self,
        owner: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Persona>>> + Send;

    /// The live persona with this id, whoever owns it. Callers own the
    /// visibility decision.
    fn get_persona(&self, id: BotId) -> impl Future<Output = Result<Option<Persona>>> + Send;

    /// Apply a patch to a live persona and return the updated row, or `None`
    /// when no live persona has this id.
    fn patch_persona(
        &self,
        id: BotId,
        req: PatchPersonaRequest,
    ) -> impl Future<Output = Result<Option<Persona>>> + Send;

    /// Soft-delete a persona. Returns whether a live persona was deleted.
    fn delete_persona(&self, id: BotId) -> impl Future<Output = Result<bool>> + Send;
}
