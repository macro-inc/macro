//! Who receives realtime Soup events outside Macro: nobody, the access of
//! [`SoupTopicEvent`].

use crate::domain::models::SoupTopicEvent;
use macro_event_broker::access::EventAccess;

impl EventAccess for SoupTopicEvent {
    type PublicPayload = macro_event_broker::access::Unexposed;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::Access;

        Ok(match self {
            Self::Updated(_) | Self::Deleted(_) => Access::Internal {
                reason: "per-user Soup cache patch protocol derived from public events",
            },
        })
    }
}
