//! Who receives `macro.users` events outside Macro, and in what shape: the
//! access of [`UserTopicEvent`].

use crate::UserTopicEvent;
use macro_event_broker::access::EventAccess;

impl EventAccess for UserTopicEvent {
    type PublicPayload = Self;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, Audience, EntityRef, EntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, user_id) = match self {
            Self::PictureChanged(metadata) => ("user.picture_changed", &metadata.user_id),
        };
        Ok(Access::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::User, user_id.to_string()),
            // The user, their contacts, and the members of their teams.
            audience: Audience::Any(vec![
                Audience::ContactsOf {
                    user_id: user_id.clone(),
                },
                Audience::TeamsOf {
                    user_id: user_id.clone(),
                },
            ]),
            stage: Stage::Stable,
            payload: Cow::Borrowed(self),
        }))
    }
}
