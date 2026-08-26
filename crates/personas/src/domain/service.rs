//! Persona domain service: validation and ownership policy.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::{PersonaError, Result};
use crate::domain::models::{
    BotId, CreatePersonaRequest, MAX_PERSONA_AVATAR_URL_BYTES, MAX_PERSONA_DESCRIPTION_CHARS,
    MAX_PERSONA_HANDLE_CHARS, MAX_PERSONA_NAME_CHARS, MAX_PERSONA_SYSTEM_PROMPT_CHARS,
    PatchPersonaRequest, Persona,
};
use crate::domain::ports::{PersonaRepo, PersonaService};

/// [`PersonaService`] over a repository.
#[derive(Debug, Clone)]
pub struct PersonaServiceImpl<R> {
    repo: R,
}

impl<R: PersonaRepo> PersonaServiceImpl<R> {
    /// Wrap a repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// The caller's persona with this id.
    ///
    /// Someone else's persona answers [`PersonaError::NotFound`], not
    /// `Unauthorized`: personas are private, so their existence is not
    /// disclosed.
    async fn owned_persona(&self, caller: &MacroUserIdStr<'static>, id: BotId) -> Result<Persona> {
        let persona = self
            .repo
            .get_persona(id)
            .await?
            .ok_or(PersonaError::NotFound)?;
        if persona.owner_user_id != caller.as_ref() {
            return Err(PersonaError::NotFound);
        }
        Ok(persona)
    }
}

fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty() {
        return Err(PersonaError::BadRequest("name must not be empty".into()));
    }
    if name.chars().count() > MAX_PERSONA_NAME_CHARS {
        return Err(PersonaError::BadRequest(format!(
            "name must be at most {MAX_PERSONA_NAME_CHARS} characters"
        )));
    }
    Ok(())
}

fn validate_handle(handle: &str) -> Result<()> {
    if handle.is_empty()
        || handle.chars().count() > MAX_PERSONA_HANDLE_CHARS
        || !handle
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err(PersonaError::BadRequest(
            "handle must be lowercase ascii, digits, '-' or '_'".into(),
        ));
    }
    // First-party agents (`@macro`, `@coder`, ...) resolve before any lookup,
    // so a persona claiming one of their handles could never be mentioned.
    if bot_id::system_bot_by_handle(handle).is_some() {
        return Err(PersonaError::HandleTaken);
    }
    Ok(())
}

fn validate_description(description: Option<&str>) -> Result<()> {
    if let Some(description) = description
        && description.chars().count() > MAX_PERSONA_DESCRIPTION_CHARS
    {
        return Err(PersonaError::BadRequest(format!(
            "description must be at most {MAX_PERSONA_DESCRIPTION_CHARS} characters"
        )));
    }
    Ok(())
}

fn validate_avatar_url(avatar_url: Option<&str>) -> Result<()> {
    if let Some(avatar_url) = avatar_url
        && avatar_url.len() > MAX_PERSONA_AVATAR_URL_BYTES
    {
        return Err(PersonaError::BadRequest(format!(
            "avatar_url must be at most {MAX_PERSONA_AVATAR_URL_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_system_prompt(system_prompt: Option<&str>) -> Result<()> {
    if let Some(system_prompt) = system_prompt
        && system_prompt.chars().count() > MAX_PERSONA_SYSTEM_PROMPT_CHARS
    {
        return Err(PersonaError::BadRequest(format!(
            "system_prompt must be at most {MAX_PERSONA_SYSTEM_PROMPT_CHARS} characters"
        )));
    }
    Ok(())
}

/// Normalize a nullable text field: whitespace-only becomes `None`.
fn normalize(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

impl<R: PersonaRepo> PersonaService for PersonaServiceImpl<R> {
    #[tracing::instrument(skip(self, req), err)]
    async fn create_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreatePersonaRequest,
    ) -> Result<Persona> {
        let req = CreatePersonaRequest {
            name: req.name.trim().to_owned(),
            handle: req.handle,
            description: normalize(req.description),
            avatar_url: normalize(req.avatar_url),
            system_prompt: normalize(req.system_prompt),
        };
        validate_name(&req.name)?;
        validate_handle(&req.handle)?;
        validate_description(req.description.as_deref())?;
        validate_avatar_url(req.avatar_url.as_deref())?;
        validate_system_prompt(req.system_prompt.as_deref())?;

        let id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
        self.repo.create_persona(id, caller, req).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_personas(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<Persona>> {
        self.repo.list_personas(caller).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_persona(&self, caller: MacroUserIdStr<'static>, id: BotId) -> Result<Persona> {
        self.owned_persona(&caller, id).await
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn patch_persona(
        &self,
        caller: MacroUserIdStr<'static>,
        id: BotId,
        req: PatchPersonaRequest,
    ) -> Result<Persona> {
        let req = PatchPersonaRequest {
            name: req.name.map(|name| name.trim().to_owned()),
            handle: req.handle,
            description: req.description.map(normalize),
            avatar_url: req.avatar_url.map(normalize),
            system_prompt: req.system_prompt.map(normalize),
        };
        if let Some(name) = &req.name {
            validate_name(name)?;
        }
        if let Some(handle) = &req.handle {
            validate_handle(handle)?;
        }
        if let Some(description) = &req.description {
            validate_description(description.as_deref())?;
        }
        if let Some(avatar_url) = &req.avatar_url {
            validate_avatar_url(avatar_url.as_deref())?;
        }
        if let Some(system_prompt) = &req.system_prompt {
            validate_system_prompt(system_prompt.as_deref())?;
        }

        self.owned_persona(&caller, id).await?;
        self.repo
            .patch_persona(id, req)
            .await?
            .ok_or(PersonaError::NotFound)
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_persona(&self, caller: MacroUserIdStr<'static>, id: BotId) -> Result<()> {
        self.owned_persona(&caller, id).await?;
        if !self.repo.delete_persona(id).await? {
            return Err(PersonaError::NotFound);
        }
        Ok(())
    }
}
