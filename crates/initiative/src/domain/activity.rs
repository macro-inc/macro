//! Initiative facts projected into the shared, replay-safe activity model.

#[cfg(test)]
mod test;

use activity::{Activity, ActivitySource, CommonAction, EntityType, Ingest};
use uuid::Uuid;

use super::events::{InitiativeChange, InitiativeTopicEvent};

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
        }
    }
}
