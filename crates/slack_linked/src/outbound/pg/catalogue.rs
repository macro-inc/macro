//! The Slack Connect catalogue, names and sending facts, as DSS reads them.

use super::*;
use crate::domain::ports::{CatalogueEntry, CatalogueRepository, ChatMembers, VisibleAdoption};
use async_trait::async_trait;
use external_chat::domain::timeline::{ExternalChatPersonRef, view::People};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;

/// What someone Slack never named is called.
const UNKNOWN_PERSON: &str = "Slack user";

/// A person's name as Slack shows it: display name, else real name.
fn person_name(display_name: Option<String>, real_name: Option<String>) -> Option<String> {
    display_name
        .filter(|name| !name.trim().is_empty())
        .or(real_name.filter(|name| !name.trim().is_empty()))
}

/// Teams by id, named.
async fn teams(pool: &PgPool, ids: &[String]) -> ExternalChatResult<HashMap<String, Team>> {
    Ok(sqlx::query!(
        "SELECT team_id, name, domain, icon_url FROM slack_team WHERE team_id = ANY($1)",
        ids
    )
    .fetch_all(pool)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| {
        (
            row.team_id.clone(),
            Team {
                team_id: row.team_id,
                name: row.name,
                domain: row.domain,
                icon_url: row.icon_url,
            },
        )
    })
    .collect())
}

/// People by Slack user id, named, with their teams.
async fn people_by_id(
    pool: &PgPool,
    ids: &[String],
) -> ExternalChatResult<HashMap<String, Person>> {
    let rows = sqlx::query!(
        "SELECT slack_user_id, team_id, display_name, real_name, avatar_url FROM slack_user WHERE slack_user_id = ANY($1)",
        ids
    )
    .fetch_all(pool)
    .await
    .map_err(failure)?;
    let team_ids: Vec<String> = rows.iter().filter_map(|row| row.team_id.clone()).collect();
    let teams = teams(pool, &team_ids).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let person = Person {
                name: person_name(row.display_name, row.real_name)
                    .unwrap_or_else(|| row.slack_user_id.clone()),
                avatar_url: row.avatar_url,
                team: row
                    .team_id
                    .as_ref()
                    .and_then(|team| teams.get(team).cloned()),
                slack_user_id: row.slack_user_id.clone(),
            };
            (row.slack_user_id, person)
        })
        .collect())
}

#[async_trait]
impl CatalogueRepository for PgSlackRepository {
    async fn catalogue(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<CatalogueEntry>> {
        let rows = sqlx::query!(
            r#"SELECT c.account_id, c.conversation_id, c.kind, c.name, c.topic, c.is_private, c.is_archived,
                c.is_member, c.frozen_reason, c.connected_team_ids, c.direct_user_id, c.last_activity_at,
                c.unread_count
            FROM slack_conversation c JOIN slack_account a ON a.id = c.account_id
            WHERE a.user_id = $1 AND a.state IN ('connecting', 'connected')"#,
            user.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let team_ids: Vec<String> = rows
            .iter()
            .flat_map(|row| row.connected_team_ids.iter().cloned())
            .collect();
        let teams = teams(&self.pool, &team_ids).await?;
        let user_ids: Vec<String> = rows
            .iter()
            .filter_map(|row| row.direct_user_id.clone())
            .collect();
        let people = people_by_id(&self.pool, &user_ids).await?;
        rows.into_iter()
            .map(|row| {
                Ok(CatalogueEntry {
                    account_id: row.account_id,
                    kind: parse(&row.kind, "conversation kind")?,
                    name: row.name,
                    topic: row.topic,
                    is_private: row.is_private,
                    is_archived: row.is_archived,
                    is_member: row.is_member,
                    frozen_reason: row.frozen_reason,
                    connected_teams: row
                        .connected_team_ids
                        .iter()
                        .map(|team| {
                            teams.get(team).cloned().unwrap_or_else(|| Team {
                                team_id: team.clone(),
                                name: team.clone(),
                                domain: None,
                                icon_url: None,
                            })
                        })
                        .collect(),
                    direct_person: row.direct_user_id.as_ref().map(|id| {
                        people.get(id).cloned().unwrap_or_else(|| Person {
                            slack_user_id: id.clone(),
                            name: id.clone(),
                            avatar_url: None,
                            team: None,
                        })
                    }),
                    last_activity_at: row.last_activity_at,
                    unread_count: u32::try_from(row.unread_count).unwrap_or(0),
                    conversation_id: row.conversation_id,
                })
            })
            .collect()
    }

    async fn request_catalogue_refresh(&self, accounts: &[Uuid]) -> ExternalChatResult<bool> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let asked = sqlx::query_scalar!(
            r#"UPDATE slack_account SET catalogue_requested_at = now()
            WHERE id = ANY($1) AND state IN ('connecting', 'connected')
              AND (catalogue_requested_at IS NULL OR catalogue_requested_at < now() - make_interval(secs => $2))
            RETURNING id"#,
            accounts,
            f64::from(CATALOGUE_REFRESH_SECONDS)
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        for account in &asked {
            notify(&mut tx, signals::CATALOGUE_REQUESTED, *account).await?;
        }
        tx.commit().await.map_err(failure)?;
        Ok(!asked.is_empty())
    }

    async fn visible_adoptions(
        &self,
        user: &MacroUserIdStr<'_>,
        conversations: &[String],
    ) -> ExternalChatResult<Vec<VisibleAdoption>> {
        Ok(sqlx::query!(
            r#"SELECT id, remote_id, name, user_id FROM external_chat
            WHERE provider = 'slack' AND remote_id = ANY($1) AND state = 'active'
              AND external_chat_can_view(id, $2)
            ORDER BY created_at DESC LIMIT 1000"#,
            conversations,
            user.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| VisibleAdoption {
            remote_id: row.remote_id,
            id: row.id,
            name: row.name,
            owner_id: row.user_id,
        })
        .collect())
    }

    async fn chat_accounts(&self, chat: Uuid, viewer: &str) -> ExternalChatResult<Vec<Uuid>> {
        sqlx::query_scalar!(
            r#"SELECT m.account_id AS "id!" FROM slack_chat_membership m WHERE m.chat_id = $1 AND m.consent_ended_at IS NULL
            UNION
            SELECT a.id FROM slack_account a JOIN slack_conversation c ON c.account_id = a.id
                JOIN external_chat e ON e.remote_id = c.conversation_id AND e.provider = 'slack'
            WHERE e.id = $1 AND a.user_id = $2 AND a.state IN ('connecting', 'connected')"#,
            chat,
            viewer
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<ChatMembers>> {
        let Some(row) = sqlx::query!(
            r#"SELECT c.name, c.observed_at FROM slack_conversation c
            JOIN slack_chat_membership m ON m.account_id = c.account_id AND m.chat_id = $1
            WHERE c.conversation_id = $2 AND m.consent_ended_at IS NULL
            ORDER BY c.observed_at DESC LIMIT 1"#,
            chat.id,
            chat.remote_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        else {
            return Ok(None);
        };
        let ids = sqlx::query_scalar!(
            "SELECT slack_user_id FROM slack_user_alias WHERE chat_id = $1 ORDER BY slack_user_id LIMIT 500",
            chat.id
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let people = people_by_id(&self.pool, &ids).await?;
        Ok(Some(ChatMembers {
            name: row.name,
            people: ids
                .iter()
                .filter_map(|id| people.get(id).cloned())
                .collect(),
            observed_at: row.observed_at,
        }))
    }

    async fn people(
        &self,
        chat: &ChatRef,
        ids: &[String],
        persons: &[Uuid],
    ) -> ExternalChatResult<People> {
        let mut people = People::new(|_| None, UNKNOWN_PERSON);
        let stored = sqlx::query!(
            r#"SELECT p.id, p.user_id, p.display_name, a.slack_user_id AS "slack_user_id?"
            FROM external_chat_person p LEFT JOIN slack_user_alias a ON a.person_id = p.id AND a.chat_id = p.chat_id
            WHERE p.chat_id = $1 AND p.id = ANY($2)"#,
            chat.id,
            persons
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let mut wanted = ids.to_vec();
        wanted.extend(stored.iter().filter_map(|row| row.slack_user_id.clone()));
        let named = people_by_id(&self.pool, &wanted).await?;
        for (id, person) in &named {
            people.learn(
                id,
                ExternalChatPersonRef {
                    name: person.name.clone(),
                    user_id: None,
                },
            );
        }
        for row in stored {
            let name = row
                .slack_user_id
                .as_ref()
                .and_then(|id| named.get(id))
                .map(|person| person.name.clone())
                .or(row.display_name);
            if let Some(name) = name {
                people.name_person(row.id, name);
            }
        }
        Ok(people)
    }

    async fn sending_facts(
        &self,
        user_id: &str,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<(bool, bool)>> {
        let ids: Vec<Uuid> = chats.iter().map(|chat| chat.id).collect();
        let rows = sqlx::query!(
            r#"SELECT m.chat_id,
                -- A conversation gone from the catalogue (no longer Slack Connect) can't be posted to.
                coalesce(bool_or(c.is_member AND NOT c.is_archived AND c.frozen_reason IS NULL), false) AS "can_post!"
            FROM slack_chat_membership m
            JOIN slack_account a ON a.id = m.account_id
            JOIN external_chat e ON e.id = m.chat_id
            LEFT JOIN slack_conversation c ON c.account_id = a.id AND c.conversation_id = e.remote_id
            WHERE m.chat_id = ANY($1) AND a.user_id = $2 AND a.state IN ('connecting', 'connected')
              AND m.generation = a.generation AND m.consent_ended_at IS NULL
            GROUP BY m.chat_id"#,
            &ids,
            user_id
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        Ok(chats
            .iter()
            .map(|chat| {
                rows.iter()
                    .find(|row| row.chat_id == chat.id)
                    .map_or((false, false), |row| (true, row.can_post))
            })
            .collect())
    }
}
