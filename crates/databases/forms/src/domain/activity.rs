//! What counts as activity in the forms domain. Lifecycle events map
//! through `Activity::attributed` with a `CommonAction` on the form; a
//! response is the form's own action, "responded", by its signed-in
//! respondent. Anonymous responses belong on nobody's feed.

#[cfg(test)]
mod test;

use ::activity::{
    Action, Activity, ActivitySource, Actor, Attribution, CommonAction, DomainActivity, EntityType,
    Ingest, event_time,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::events::{self, FormTopicEvent};
use super::models::FormId;

/// Someone responded to a form: an action only forms have.
pub struct FormResponded {
    form_id: String,
}

impl FormResponded {
    /// A response to `form_id`.
    pub fn new(form_id: FormId) -> Self {
        Self {
            form_id: form_id.to_string(),
        }
    }
}

impl DomainActivity for FormResponded {
    const ENTITY_TYPE: EntityType = EntityType::Form;

    fn entity_id(&self) -> &str {
        &self.form_id
    }

    fn into_action(self) -> Action {
        Action::Responded
    }
}

impl ActivitySource for FormTopicEvent {
    /// Maps one `macro.forms` event to its ingest outcome. Exhaustive on
    /// purpose: a new event variant fails compilation here until someone
    /// classifies it.
    fn ingest(&self, event_id: Uuid) -> Ingest {
        let single = |attribution: Attribution,
                      action: CommonAction,
                      form_id: FormId,
                      occurred_at: DateTime<Utc>| {
            Ingest::Insert(vec![Activity::attributed(
                event_id,
                0,
                attribution,
                EntityType::Form,
                form_id.to_string(),
                action,
                occurred_at,
            )])
        };
        // Internal callers carry no attribution; their changes belong on
        // nobody's feed and are dropped.
        let attributed = |attribution: &Option<events::Attribution>,
                          action: CommonAction,
                          form_id: FormId| match attribution {
            Some(attribution) => single(
                Attribution::new(attribution.actor.clone(), attribution.on_behalf_of.clone()),
                action,
                form_id,
                event_time(event_id),
            ),
            None => Ingest::Ignore,
        };

        match self {
            FormTopicEvent::Created(metadata) => single(
                Attribution::new(
                    metadata.attribution.actor.clone(),
                    metadata.attribution.on_behalf_of.clone(),
                ),
                CommonAction::Created,
                metadata.form_id,
                metadata.created_at,
            ),
            FormTopicEvent::Renamed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Edited,
                metadata.form_id,
            ),
            FormTopicEvent::Trashed(metadata) => attributed(
                &metadata.attribution,
                CommonAction::Deleted,
                metadata.form_id,
            ),
            // Coming back from the trash is a change to the form, not a
            // second creation.
            FormTopicEvent::Restored(metadata) | FormTopicEvent::SharingChanged(metadata) => {
                attributed(
                    &metadata.attribution,
                    CommonAction::Edited,
                    metadata.form_id,
                )
            }
            FormTopicEvent::ResponseSubmitted(metadata) => match &metadata.respondent {
                Some(respondent) => Ingest::Insert(vec![Activity::from_domain(
                    event_id,
                    0,
                    Actor::new_from_user(respondent.clone()),
                    None,
                    FormResponded::new(metadata.form_id),
                    metadata.submitted_at,
                )]),
                None => Ingest::Ignore,
            },
            FormTopicEvent::Purged(metadata) => {
                Ingest::Purge(vec![(EntityType::Form, metadata.form_id.to_string())])
            }
        }
    }
}
