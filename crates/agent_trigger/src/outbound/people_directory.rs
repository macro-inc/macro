//! Names people from MacroDB profiles and bots from the bots repository.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use agent_session::domain::error::{AgentSessionError, Result};
use bot_id::BotId;
use bots::domain::ports::BotRepo;
use channel_sender::ChannelSender;
use sqlx::PgPool;
use trigger_context::ContextPerson;

use crate::domain::context::PeopleDirectory;

/// Stands in for a name part a user never filled in.
const UNSET_NAME: &str = "N/A";

/// Reads the names bots carry. A seam so the directory can be tested without
/// the bots table.
trait BotNames: Send + Sync + 'static {
    /// Names of the requested bots that have a profile, soft-deleted ones included.
    fn bot_names(
        &self,
        bot_ids: &[BotId],
    ) -> impl Future<Output = Result<HashMap<BotId, String>>> + Send;
}

impl<Repo: BotRepo> BotNames for Repo {
    async fn bot_names(&self, bot_ids: &[BotId]) -> Result<HashMap<BotId, String>> {
        let mut names: HashMap<BotId, String> = bot_ids
            .iter()
            .filter_map(|bot_id| {
                bot_id::system_bot(*bot_id).map(|bot| (*bot_id, bot.name.to_owned()))
            })
            .collect();
        let stored: Vec<BotId> = bot_ids
            .iter()
            .copied()
            .filter(|bot_id| !names.contains_key(bot_id))
            .collect();
        if !stored.is_empty() {
            let profiles = self
                .get_bot_profiles(&stored)
                .await
                .map_err(|error| AgentSessionError::Unknown(error.into()))?;
            names.extend(
                profiles
                    .into_iter()
                    .map(|(bot_id, profile)| (bot_id, profile.name)),
            );
        }
        Ok(names)
    }
}

/// Names users by their profile name and bots by their profile.
pub struct PgPeopleDirectory<Bots> {
    pool: PgPool,
    bots: Bots,
}

impl<Bots> PgPeopleDirectory<Bots> {
    /// Compose MacroDB, for user names, with the bots repository.
    pub fn new(pool: PgPool, bots: Bots) -> Self {
        Self { pool, bots }
    }

    async fn user_names(&self, user_ids: Vec<String>) -> Result<HashMap<String, String>> {
        if user_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = sqlx::query!(
            r#"
        SELECT u.id as user_profile_id, mui.first_name, mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
            &user_ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                display_name(row.first_name.as_deref(), row.last_name.as_deref())
                    .map(|name| (row.user_profile_id, name))
            })
            .collect())
    }
}

impl<Bots: BotNames> PeopleDirectory for PgPeopleDirectory<Bots> {
    async fn people(&self, ids: Vec<String>) -> Result<Vec<ContextPerson>> {
        let senders: Vec<Option<ChannelSender<'_>>> = ids
            .iter()
            .map(|id| ChannelSender::parse_from_str(id).ok())
            .collect();
        let user_ids = senders
            .iter()
            .flatten()
            .filter_map(|sender| sender.as_user().map(|user| user.as_ref().to_owned()))
            .collect();
        let bot_ids: Vec<BotId> = senders
            .iter()
            .flatten()
            .filter_map(|sender| sender.as_bot().map(|bot| bot.bot_id()))
            .collect();
        let user_names = self.user_names(user_ids).await?;
        let bot_names = self.bots.bot_names(&bot_ids).await?;

        Ok(ids
            .iter()
            .zip(&senders)
            .map(|(id, sender)| {
                let user = sender.as_ref().and_then(ChannelSender::as_user);
                let bot = sender.as_ref().and_then(ChannelSender::as_bot);
                match (user, bot) {
                    (Some(user), _) => ContextPerson {
                        id: id.clone(),
                        name: user_names
                            .get(id)
                            .cloned()
                            .unwrap_or_else(|| user.email_str().to_owned()),
                        email: Some(user.email_str().to_owned()),
                    },
                    (None, Some(bot)) => ContextPerson {
                        id: id.clone(),
                        name: bot_names
                            .get(&bot.bot_id())
                            .cloned()
                            .unwrap_or_else(|| id.clone()),
                        email: None,
                    },
                    (None, None) => ContextPerson {
                        id: id.clone(),
                        name: id.clone(),
                        email: None,
                    },
                }
            })
            .collect())
    }
}

/// "First Last" from whichever parts the user set.
fn display_name(first: Option<&str>, last: Option<&str>) -> Option<String> {
    match (name_part(first), name_part(last)) {
        (None, None) => None,
        (Some(only), None) | (None, Some(only)) => Some(only.to_owned()),
        (Some(first), Some(last)) => Some(format!("{first} {last}")),
    }
}

/// A name part the user actually set.
fn name_part(part: Option<&str>) -> Option<&str> {
    part.map(str::trim)
        .filter(|part| !part.is_empty() && *part != UNSET_NAME)
}
