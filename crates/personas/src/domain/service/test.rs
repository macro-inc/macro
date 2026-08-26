use std::collections::HashMap;
use std::sync::Mutex;

use super::*;
use crate::domain::ports::PersonaService;

/// In-memory [`PersonaRepo`] for service policy tests.
#[derive(Default)]
struct FakeRepo {
    personas: Mutex<HashMap<BotId, Persona>>,
}

impl FakeRepo {
    fn insert(&self, persona: Persona) {
        self.personas.lock().unwrap().insert(persona.id, persona);
    }
}

impl PersonaRepo for FakeRepo {
    async fn create_persona(
        &self,
        id: BotId,
        owner: MacroUserIdStr<'static>,
        req: CreatePersonaRequest,
    ) -> Result<Persona> {
        let mut personas = self.personas.lock().unwrap();
        if personas
            .values()
            .any(|p| p.owner_user_id == owner.as_ref() && p.handle == req.handle)
        {
            return Err(PersonaError::HandleTaken);
        }
        let persona = Persona {
            id,
            owner_user_id: owner.as_ref().to_owned(),
            name: req.name,
            handle: req.handle,
            description: req.description,
            avatar_url: req.avatar_url,
            system_prompt: req.system_prompt,
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
        };
        personas.insert(id, persona.clone());
        Ok(persona)
    }

    async fn list_personas(&self, owner: MacroUserIdStr<'static>) -> Result<Vec<Persona>> {
        Ok(self
            .personas
            .lock()
            .unwrap()
            .values()
            .filter(|p| p.owner_user_id == owner.as_ref())
            .cloned()
            .collect())
    }

    async fn get_persona(&self, id: BotId) -> Result<Option<Persona>> {
        Ok(self.personas.lock().unwrap().get(&id).cloned())
    }

    async fn patch_persona(&self, id: BotId, req: PatchPersonaRequest) -> Result<Option<Persona>> {
        let mut personas = self.personas.lock().unwrap();
        let Some(persona) = personas.get_mut(&id) else {
            return Ok(None);
        };
        if let Some(name) = req.name {
            persona.name = name;
        }
        if let Some(handle) = req.handle {
            persona.handle = handle;
        }
        if let Some(description) = req.description {
            persona.description = description;
        }
        if let Some(avatar_url) = req.avatar_url {
            persona.avatar_url = avatar_url;
        }
        if let Some(system_prompt) = req.system_prompt {
            persona.system_prompt = system_prompt;
        }
        Ok(Some(persona.clone()))
    }

    async fn delete_persona(&self, id: BotId) -> Result<bool> {
        Ok(self.personas.lock().unwrap().remove(&id).is_some())
    }
}

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn owner() -> MacroUserIdStr<'static> {
    user("macro|owner@example.com")
}

fn stranger() -> MacroUserIdStr<'static> {
    user("macro|stranger@example.com")
}

fn create_req(name: &str, handle: &str) -> CreatePersonaRequest {
    CreatePersonaRequest {
        name: name.to_owned(),
        handle: handle.to_owned(),
        description: None,
        avatar_url: None,
        system_prompt: None,
    }
}

fn service() -> PersonaServiceImpl<FakeRepo> {
    PersonaServiceImpl::new(FakeRepo::default())
}

#[tokio::test]
async fn create_returns_persona_owned_by_caller() {
    let service = service();
    let persona = service
        .create_persona(owner(), create_req("Bug Fixer", "bug-fixer"))
        .await
        .unwrap();
    assert_eq!(persona.owner_user_id, owner().as_ref());
    assert_eq!(persona.handle, "bug-fixer");
}

#[tokio::test]
async fn create_rejects_bad_handles() {
    let service = service();
    for handle in ["", "Has-Upper", "with space", "emoji-🤖"] {
        let err = service
            .create_persona(owner(), create_req("Bot", handle))
            .await
            .unwrap_err();
        assert!(matches!(err, PersonaError::BadRequest(_)), "{handle}");
    }
}

#[tokio::test]
async fn create_rejects_reserved_first_party_handles() {
    let service = service();
    for handle in ["macro", "coder", "cursor"] {
        let err = service
            .create_persona(owner(), create_req("Bot", handle))
            .await
            .unwrap_err();
        assert!(matches!(err, PersonaError::HandleTaken), "{handle}");
    }
}

#[tokio::test]
async fn create_rejects_empty_name_and_over_long_prompt() {
    let service = service();
    let err = service
        .create_persona(owner(), create_req("   ", "bot"))
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::BadRequest(_)));

    let mut req = create_req("Bot", "bot");
    req.system_prompt = Some("x".repeat(MAX_PERSONA_SYSTEM_PROMPT_CHARS + 1));
    let err = service.create_persona(owner(), req).await.unwrap_err();
    assert!(matches!(err, PersonaError::BadRequest(_)));
}

#[tokio::test]
async fn create_normalizes_blank_optionals_to_none() {
    let service = service();
    let mut req = create_req("Bot", "bot");
    req.description = Some("   ".to_owned());
    req.system_prompt = Some(String::new());
    let persona = service.create_persona(owner(), req).await.unwrap();
    assert_eq!(persona.description, None);
    assert_eq!(persona.system_prompt, None);
}

#[tokio::test]
async fn get_and_patch_and_delete_hide_other_users_personas() {
    let service = service();
    let persona = service
        .create_persona(owner(), create_req("Bot", "bot"))
        .await
        .unwrap();

    let err = service
        .get_persona(stranger(), persona.id)
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::NotFound));

    let err = service
        .patch_persona(
            stranger(),
            persona.id,
            PatchPersonaRequest {
                name: Some("Taken Over".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::NotFound));

    let err = service
        .delete_persona(stranger(), persona.id)
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::NotFound));

    // The owner still sees it untouched.
    let fetched = service.get_persona(owner(), persona.id).await.unwrap();
    assert_eq!(fetched.name, "Bot");
}

#[tokio::test]
async fn patch_applies_field_semantics() {
    let service = service();
    let mut req = create_req("Bot", "bot");
    req.description = Some("original".to_owned());
    let persona = service.create_persona(owner(), req).await.unwrap();

    // Absent leaves unchanged; null clears; value replaces.
    let patched = service
        .patch_persona(
            owner(),
            persona.id,
            PatchPersonaRequest {
                name: Some("Renamed".to_owned()),
                description: Some(None),
                system_prompt: Some(Some("be terse".to_owned())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(patched.name, "Renamed");
    assert_eq!(patched.handle, "bot");
    assert_eq!(patched.description, None);
    assert_eq!(patched.system_prompt, Some("be terse".to_owned()));
}

#[tokio::test]
async fn patch_rejects_reserved_handle() {
    let service = service();
    let persona = service
        .create_persona(owner(), create_req("Bot", "bot"))
        .await
        .unwrap();
    let err = service
        .patch_persona(
            owner(),
            persona.id,
            PatchPersonaRequest {
                handle: Some("macro".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, PersonaError::HandleTaken));
}

#[tokio::test]
async fn delete_removes_the_persona() {
    let service = service();
    let persona = service
        .create_persona(owner(), create_req("Bot", "bot"))
        .await
        .unwrap();
    service.delete_persona(owner(), persona.id).await.unwrap();
    let err = service.get_persona(owner(), persona.id).await.unwrap_err();
    assert!(matches!(err, PersonaError::NotFound));
}
