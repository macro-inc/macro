//! What opened a session: one `agent_session_source` row per session, written
//! in the transaction that writes the session itself.

use super::*;
use trigger_context::TriggerOrigin;
use trigger_context::origin::{AgentActor, Caller, Lineage, Root, RoutineCause};

#[cfg(test)]
mod test;

/// A stored source, read back into the enum. The table's constraints admit
/// only rows that map, so one that does not is logged and reads as unknown
/// rather than failing every read of its session.
#[derive(Debug, serde::Deserialize)]
pub(super) struct SourceRow {
    id: Uuid,
    kind: String,
    actor_user_id: Option<MacroUserIdStr<'static>>,
    actor_bot_id: Option<Uuid>,
    on_behalf_of_user_id: Option<MacroUserIdStr<'static>>,
    acting_session_id: Option<Uuid>,
    root_user_id: Option<MacroUserIdStr<'static>>,
    root_routine_id: Option<Uuid>,
    message_id: Option<Uuid>,
    task_id: Option<String>,
    project_id: Option<Uuid>,
    routine_id: Option<Uuid>,
    routine_firing: Option<String>,
    event_id: Option<Uuid>,
}

impl SourceRow {
    pub(super) fn into_origin(self) -> TriggerOrigin {
        let id = self.id;
        self.origin().unwrap_or_else(|| {
            tracing::warn!(source_id = %id, "agent session source does not map to an origin");
            TriggerOrigin::Unknown
        })
    }

    fn caller(&self) -> Option<Caller> {
        match (&self.actor_user_id, self.actor_bot_id) {
            (Some(user), None) => Some(Caller::Person { user: user.clone() }),
            (None, Some(bot)) => Some(Caller::Agent(AgentActor {
                bot: BotId::new_from_uuid(bot),
                on_behalf_of: self.on_behalf_of_user_id.clone()?,
                lineage: self.lineage()?,
            })),
            _ => None,
        }
    }

    fn lineage(&self) -> Option<Lineage> {
        let Some(session) = self.acting_session_id else {
            return Some(Lineage::Unattributed);
        };
        let root = match (&self.root_user_id, self.root_routine_id) {
            (Some(user), None) => Root::Person { user: user.clone() },
            (None, Some(routine)) => Root::Routine { routine },
            _ => return None,
        };
        Some(Lineage::Session { session, root })
    }

    fn origin(&self) -> Option<TriggerOrigin> {
        Some(match self.kind.as_str() {
            "mentioned" => TriggerOrigin::Mentioned {
                by: self.caller()?,
                message_id: self.message_id?,
            },
            "conversation" => TriggerOrigin::Conversation {
                by: self.actor_user_id.clone()?,
                message_id: self.message_id?,
            },
            "task_assigned" => TriggerOrigin::TaskAssigned {
                by: self.caller()?,
                task: self.task_id.clone()?,
            },
            "project_inherited" => TriggerOrigin::ProjectInherited {
                by: self.caller()?,
                task: self.task_id.clone()?,
                project: self.project_id?,
            },
            "requested" => TriggerOrigin::Requested {
                by: self.actor_user_id.clone()?,
            },
            "dispatched" => TriggerOrigin::Dispatched {
                on_behalf_of: self.on_behalf_of_user_id.clone()?,
            },
            "routine_draft" => TriggerOrigin::RoutineDraft {
                by: self.actor_user_id.clone()?,
            },
            "routine" => TriggerOrigin::Routine {
                routine: self.routine_id?,
                firing: match self.routine_firing.as_deref()? {
                    "scheduled" => RoutineCause::Scheduled,
                    "manual" => RoutineCause::Manual,
                    "event" => RoutineCause::Event {
                        event_id: self.event_id?,
                    },
                    _ => return None,
                },
            },
            _ => return None,
        })
    }
}

/// A [`TriggerOrigin`] as the table's columns. The table's constraints repeat
/// the enum's invariants.
#[derive(Default)]
struct SourceColumns {
    actor_user_id: Option<String>,
    actor_bot_id: Option<Uuid>,
    on_behalf_of_user_id: Option<String>,
    acting_session_id: Option<Uuid>,
    root_user_id: Option<String>,
    root_routine_id: Option<Uuid>,
    message_id: Option<Uuid>,
    task_id: Option<String>,
    project_id: Option<Uuid>,
    routine_id: Option<Uuid>,
    routine_firing: Option<&'static str>,
    event_id: Option<Uuid>,
}

impl SourceColumns {
    fn with_caller(mut self, caller: &Caller) -> Self {
        match caller {
            Caller::Person { user } => {
                self.actor_user_id = Some(user.as_ref().to_owned());
            }
            Caller::Agent(AgentActor {
                bot,
                on_behalf_of,
                lineage,
            }) => {
                self.actor_bot_id = Some(bot.as_uuid());
                self.on_behalf_of_user_id = Some(on_behalf_of.as_ref().to_owned());
                if let Lineage::Session { session, root } = lineage {
                    self.acting_session_id = Some(*session);
                    match root {
                        Root::Person { user } => {
                            self.root_user_id = Some(user.as_ref().to_owned());
                        }
                        Root::Routine { routine } => {
                            self.root_routine_id = Some(*routine);
                        }
                    }
                }
            }
        }
        self
    }
}

/// The row's `kind` and columns, or nothing for an origin that is not known.
fn source_columns(origin: &TriggerOrigin) -> Option<(&'static str, SourceColumns)> {
    let columns = SourceColumns::default();
    Some(match origin {
        TriggerOrigin::Mentioned { by, message_id } => (
            "mentioned",
            SourceColumns {
                message_id: Some(*message_id),
                ..columns
            }
            .with_caller(by),
        ),
        TriggerOrigin::Conversation { by, message_id } => (
            "conversation",
            SourceColumns {
                actor_user_id: Some(by.as_ref().to_owned()),
                message_id: Some(*message_id),
                ..columns
            },
        ),
        TriggerOrigin::TaskAssigned { by, task } => (
            "task_assigned",
            SourceColumns {
                task_id: Some(task.clone()),
                ..columns
            }
            .with_caller(by),
        ),
        TriggerOrigin::ProjectInherited { by, task, project } => (
            "project_inherited",
            SourceColumns {
                task_id: Some(task.clone()),
                project_id: Some(*project),
                ..columns
            }
            .with_caller(by),
        ),
        TriggerOrigin::Requested { by } => (
            "requested",
            SourceColumns {
                actor_user_id: Some(by.as_ref().to_owned()),
                ..columns
            },
        ),
        TriggerOrigin::Dispatched { on_behalf_of } => (
            "dispatched",
            SourceColumns {
                on_behalf_of_user_id: Some(on_behalf_of.as_ref().to_owned()),
                ..columns
            },
        ),
        TriggerOrigin::RoutineDraft { by } => (
            "routine_draft",
            SourceColumns {
                actor_user_id: Some(by.as_ref().to_owned()),
                ..columns
            },
        ),
        TriggerOrigin::Routine { routine, firing } => {
            let (routine_firing, event_id) = match firing {
                RoutineCause::Scheduled => ("scheduled", None),
                RoutineCause::Manual => ("manual", None),
                RoutineCause::Event { event_id } => ("event", Some(*event_id)),
            };
            (
                "routine",
                SourceColumns {
                    routine_id: Some(*routine),
                    routine_firing: Some(routine_firing),
                    event_id,
                    ..columns
                },
            )
        }
        TriggerOrigin::Unknown => return None,
    })
}

/// Write a session's source, returning the id its row references.
pub(super) async fn insert_source(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    origin: &TriggerOrigin,
) -> Result<Option<Uuid>> {
    let Some((kind, columns)) = source_columns(origin) else {
        return Ok(None);
    };
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO agent_session_source (
            id, kind, actor_user_id, actor_bot_id, on_behalf_of_user_id, acting_session_id,
            root_user_id, root_routine_id, message_id, task_id, project_id, routine_id,
            routine_firing, event_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        "#,
        id,
        kind,
        columns.actor_user_id,
        columns.actor_bot_id,
        columns.on_behalf_of_user_id,
        columns.acting_session_id,
        columns.root_user_id,
        columns.root_routine_id,
        columns.message_id,
        columns.task_id,
        columns.project_id,
        columns.routine_id,
        columns.routine_firing,
        columns.event_id,
    )
    .execute(&mut **transaction)
    .await
    .context("failed to write agent session source")?;
    Ok(Some(id))
}

/// Give a session that exists without a source its source.
pub(super) async fn link_source(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    session: AgentSessionId,
    origin: &TriggerOrigin,
) -> Result<()> {
    let Some(source_id) = insert_source(transaction, origin).await? else {
        return Ok(());
    };
    sqlx::query!(
        "UPDATE agent_session SET source_id = $2 WHERE id = $1",
        session.as_uuid(),
        source_id,
    )
    .execute(&mut **transaction)
    .await
    .context("failed to link agent session source")?;
    Ok(())
}

/// Remove the source of a session being deleted, after the session's row.
pub(super) async fn delete_source(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    source_id: Uuid,
) -> Result<()> {
    sqlx::query!("DELETE FROM agent_session_source WHERE id = $1", source_id)
        .execute(&mut **transaction)
        .await
        .context("failed to delete agent session source")?;
    Ok(())
}
