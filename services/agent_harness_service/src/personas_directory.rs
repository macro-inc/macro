//! Postgres-backed [`PersonaDirectory`] for the harness.
//!
//! A composition-root adapter: the harness domain asks "is this bot a
//! persona, and what instructions does it carry", and this answers from the
//! personas table without the harness crate depending on `personas`.

use agent_harness::domain::ports::{PersonaDirectory, PersonaFacts};
use bot_id::BotId;
use personas::domain::ports::PersonaRepo;
use personas::outbound::pg_personas_repo::PgPersonasRepo;

/// [`PersonaDirectory`] over the personas table.
#[derive(Clone)]
pub struct PgPersonaDirectory {
    repo: PgPersonasRepo,
}

impl PgPersonaDirectory {
    /// Wrap a personas repo.
    pub fn new(repo: PgPersonasRepo) -> Self {
        Self { repo }
    }
}

impl PersonaDirectory for PgPersonaDirectory {
    async fn persona(&self, bot: BotId) -> anyhow::Result<Option<PersonaFacts>> {
        let persona = self
            .repo
            .get_persona(bot)
            .await
            .map_err(|error| anyhow::anyhow!("failed to look up persona: {error}"))?;
        Ok(persona.map(|persona| PersonaFacts {
            system_prompt: persona.system_prompt,
        }))
    }
}
