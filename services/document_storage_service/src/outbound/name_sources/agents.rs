//! Agents: the agents the viewer can manage or start a session as, listed
//! once and kept when a name or handle contains a needle.

use std::sync::Arc;

use bots::domain::ports::BotService;
use models_search::names::{NameKind, NamedItem};
use search_service::names::{Candidate, NameSource, NameSourceError, NameViewer, Needle};

use super::{contains_any, internal};

/// Agents the viewer can use, by name, also answering to their handle.
pub struct AgentNames<S> {
    service: Arc<S>,
}

impl<S> AgentNames<S> {
    /// A source over the bot service the agent routes use.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

// `async_trait` because the lookup holds sources as `Arc<dyn NameSource>`.
#[async_trait::async_trait]
impl<S: BotService> NameSource for AgentNames<S> {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Agent]
    }

    #[tracing::instrument(
        name = "search.names.agents",
        skip_all,
        fields(listed = tracing::field::Empty),
        err
    )]
    async fn find(
        &self,
        viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        let agents = self
            .service
            .list_agents(viewer.user.clone())
            .await
            .map_err(internal)?;
        tracing::Span::current().record("listed", agents.len());

        Ok(agents
            .into_iter()
            .map(|agent| agent.bot)
            .filter(|bot| bot.deleted_at.is_none())
            .filter(|bot| contains_any(&bot.name, needles) || contains_any(&bot.handle, needles))
            .map(|bot| Candidate {
                item: NamedItem::Agent {
                    id: bot.id.as_uuid(),
                },
                name: bot.name,
                aliases: vec![bot.handle],
            })
            .collect())
    }
}
