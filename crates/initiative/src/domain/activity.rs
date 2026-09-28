//! Initiative facts projected into the shared, replay-safe activity model.

#[cfg(test)]
mod test;

use activity::{
    Action, Activity, ActivitySource, CommonAction, DomainActivity, EntityType, Ingest,
    InitiativeTaskChange,
};
use uuid::Uuid;

use super::events::{InitiativeChange, InitiativeTopicEvent};

enum MembershipActivity {
    Added {
        initiative_id: String,
        task_id: String,
    },
    Removed {
        initiative_id: String,
        task_id: String,
    },
}

impl DomainActivity for MembershipActivity {
    const ENTITY_TYPE: EntityType = EntityType::Initiative;
    fn entity_id(&self) -> &str {
        match self {
            Self::Added { initiative_id, .. } | Self::Removed { initiative_id, .. } => {
                initiative_id
            }
        }
    }
    fn into_action(self) -> Action {
        match self {
            Self::Added { task_id, .. } => Action::TaskAdded(InitiativeTaskChange { task_id }),
            Self::Removed { task_id, .. } => Action::TaskRemoved(InitiativeTaskChange { task_id }),
        }
    }
}

fn lifecycle(event_id: Uuid, change: &InitiativeChange, action: CommonAction) -> Ingest {
    let Some(attribution) = &change.attribution else {
        return Ingest::Ignore;
    };
    Ingest::Insert(vec![Activity::common(
        event_id,
        0,
        attribution.actor.clone(),
        attribution.on_behalf_of.clone(),
        EntityType::Initiative,
        change.initiative_id.to_string(),
        action,
        change.occurred_at,
    )])
}

impl ActivitySource for InitiativeTopicEvent {
    fn ingest(&self, event_id: Uuid) -> Ingest {
        match self {
            Self::Created(change) => lifecycle(event_id, change, CommonAction::Created),
            Self::Updated(change) => lifecycle(event_id, change, CommonAction::Edited),
            Self::Purged { initiative_id } => {
                Ingest::Purge(vec![(EntityType::Initiative, initiative_id.to_string())])
            }
            Self::TasksChanged(changed) => {
                let Some(attribution) = &changed.attribution else {
                    return Ingest::Ignore;
                };
                let mut rows = Vec::new();
                // At most 100 changes per service command; source/removal is always the
                // first ordinal and destination/addition the second, including replays.
                for (index, change) in changed.changes.iter().enumerate() {
                    if change.from == change.to {
                        continue;
                    }
                    let ordinal = u32::try_from(index).expect("bounded task batch") * 2;
                    if let Some(source) = change.from {
                        rows.push(Activity::from_domain(
                            event_id,
                            ordinal,
                            attribution.actor.clone(),
                            attribution.on_behalf_of.clone(),
                            MembershipActivity::Removed {
                                initiative_id: source.to_string(),
                                task_id: change.task_id.clone(),
                            },
                            changed.occurred_at,
                        ));
                    }
                    if let Some(destination) = change.to {
                        rows.push(Activity::from_domain(
                            event_id,
                            ordinal + 1,
                            attribution.actor.clone(),
                            attribution.on_behalf_of.clone(),
                            MembershipActivity::Added {
                                initiative_id: destination.to_string(),
                                task_id: change.task_id.clone(),
                            },
                            changed.occurred_at,
                        ));
                    }
                }
                if rows.is_empty() {
                    Ingest::Ignore
                } else {
                    Ingest::Insert(rows)
                }
            }
        }
    }
}
