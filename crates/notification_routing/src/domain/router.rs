//! The router `notification` calls at ingress.

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use futures::future::join_all;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::NotifEvent;
use notification::domain::models::routing::{RecipientRoute, RecipientRoutes, RoutedNotification};
use notification::domain::ports::NotificationRouter;
use rootcause::Report;
use serde::Serialize;

use crate::domain::evaluate::{Conversation, Place, Routed};
use crate::domain::models::{NOTIFICATION_STACKS_FLAG, NotificationStack, RoutingOutcome};
use crate::domain::ports::{DocumentPlacements, StackRepository};

/// Routes a notification through each recipient's own stacks.
#[derive(Debug, Clone)]
pub struct StackRouter<R, P, F> {
    stacks: R,
    placements: P,
    flags: F,
}

impl<R, P, F> StackRouter<R, P, F>
where
    R: StackRepository,
    P: DocumentPlacements,
    F: FeatureFlags + 'static,
{
    /// Create a router over the stored stacks, for the people `flags` turns
    /// stacks on for.
    pub fn new(stacks: R, placements: P, flags: F) -> Self {
        Self {
            stacks,
            placements,
            flags,
        }
    }

    /// Whether stacks are on for `owner`. A flag that cannot be read counts
    /// as off: the notification is then delivered as usual.
    async fn enabled(&self, owner: &MacroUserIdStr<'_>) -> bool {
        match self.flags.load(owner).await {
            Ok(flags) => flags.is_enabled(NOTIFICATION_STACKS_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to read the notification stacks flag");
                false
            }
        }
    }
}

impl<R, P, F> NotificationRouter for StackRouter<R, P, F>
where
    R: StackRepository,
    P: DocumentPlacements,
    F: FeatureFlags + 'static,
{
    async fn route<T: Serialize + Send + Sync>(
        &self,
        notification: RoutedNotification<'_, T>,
    ) -> Result<RecipientRoutes, Report> {
        let recipients: Vec<MacroUserIdStr<'_>> = notification
            .recipients
            .iter()
            .map(|recipient| recipient.copied())
            .collect();
        let stacks = self
            .stacks
            .enabled_for(&recipients)
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        if stacks.is_empty() {
            return Ok(RecipientRoutes::new());
        }

        // A type this crate cannot read is one no stack captures.
        let event = serde_json::to_value(notification.notification)
            .and_then(serde_json::from_value::<NotifEvent>);
        let Ok(event) = event else {
            tracing::debug!(
                notification_type = notification.notification_type,
                "notification is not a routable event"
            );
            return Ok(RecipientRoutes::new());
        };
        let Some(mut conversation) =
            Conversation::of(&event, notification.entity, notification.sender_id)
        else {
            return Ok(RecipientRoutes::new());
        };

        if let Place::Document {
            id,
            is_task,
            placement,
        } = &mut conversation.place
        {
            let needed = stacks.values().flatten().any(needs_placement);
            if needed {
                *placement = self.placements.placement(id, *is_task).await?;
            }
        }

        let routed = stacks
            .into_iter()
            .filter_map(|(owner, stacks)| Some((owner, conversation.route(&stacks)?)));

        // The flag is read last and only for someone a stack routes for:
        // every read is a request to the flag provider.
        let decided = join_all(routed.map(|(owner, routed)| async move {
            let enabled = self.enabled(&owner).await;
            (owner, routed, enabled)
        }))
        .await;

        decided
            .into_iter()
            .filter(|(_, _, enabled)| *enabled)
            .map(|(owner, routed, _)| Ok((owner, recipient_route(routed)?)))
            .collect()
    }
}

fn needs_placement(stack: &NotificationStack) -> bool {
    stack
        .capture
        .iter()
        .chain(&stack.release)
        .flat_map(|rule| &rule.sources)
        .any(|source| source.needs_placement())
}

fn recipient_route(routed: Routed) -> Result<RecipientRoute, Report> {
    let captured = routed.record.outcome == RoutingOutcome::Captured;

    Ok(RecipientRoute {
        lane: routed.lane,
        stack_id: captured.then_some(routed.record.stack_id),
        routing: serde_json::to_value(&routed.record)?,
    })
}
