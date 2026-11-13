//! Ending suggestions by events between generation runs: the one place code changes
//! a suggestion's state on its own.
//!
//! Kept literal on purpose. An event names an item; the open suggestions about that
//! item that the event settles are resolved, with the reason in
//! `state_reason`. Anything that takes judgement (a suggestion that stopped
//! mattering, a reply that didn't really answer) is left to the next
//! generation session.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;

use super::model::{OpenTarget, ResolveReason, SuggestionError, Target};
use super::ports::{ResolveSuggestions, SuggestionAccess, SuggestionRepo};

#[cfg(test)]
mod test;

/// An item an event is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// The item's type.
    pub entity_type: EntityType,
    /// The item's id.
    pub entity_id: String,
}

/// Something that happened to an item that can end suggestions about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolutionEvent {
    /// The person sent or posted on the item themself.
    Replied {
        /// Who sent or posted.
        user: MacroUserIdStr<'static>,
        /// Where.
        item: Item,
        /// The thread, by its root part, the post replied in; `None` when it
        /// answers the whole item, as a sent email or a new channel message
        /// does.
        thread: Option<String>,
        /// When it was sent or posted.
        at: DateTime<Utc>,
    },
    /// The item, or one part of it, was deleted.
    Deleted {
        /// The item.
        item: Item,
        /// The deleted part; `None` when the whole item was.
        part: Option<String>,
    },
    /// Who can open the item may have changed.
    AccessChanged {
        /// The item.
        item: Item,
        /// The people who may have lost access; `None` when it could be
        /// anyone.
        users: Option<Vec<MacroUserIdStr<'static>>>,
    },
}

impl ResolutionEvent {
    /// The item the event is about.
    pub fn item(&self) -> &Item {
        match self {
            Self::Replied { item, .. }
            | Self::Deleted { item, .. }
            | Self::AccessChanged { item, .. } => item,
        }
    }

    /// The event's kind, for traces.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Replied { .. } => "replied",
            Self::Deleted { .. } => "deleted",
            Self::AccessChanged { .. } => "access_changed",
        }
    }

    /// Whether the event settles the open suggestion `target` names, before any
    /// access check.
    fn settles(&self, target: &OpenTarget) -> bool {
        match self {
            Self::Replied {
                user,
                item,
                thread,
                at,
            } => {
                // A suggestion about one channel thread ends with a reply in that
                // thread; a suggestion about a whole item, or about one message of
                // an email thread, with any reply on it (sent mail names no
                // thread part).
                let same_thread = match (&target.part_id, thread) {
                    (Some(part), Some(thread)) => part == thread,
                    (Some(_), None) => item.entity_type == EntityType::EmailThread,
                    (None, _) => true,
                };
                target.reply && target.user == *user && target.created_at < *at && same_thread
            }
            Self::Deleted { part, .. } => part.is_none() || target.part_id == *part,
            Self::AccessChanged { users, .. } => users
                .as_ref()
                .is_none_or(|users| users.contains(&target.user)),
        }
    }

    fn reason(&self) -> ResolveReason {
        match self {
            Self::Replied { .. } => ResolveReason::Replied,
            Self::Deleted { .. } => ResolveReason::Deleted,
            Self::AccessChanged { .. } => ResolveReason::AccessLost,
        }
    }
}

/// What resolving an event did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Resolved {
    /// Open suggestions the event matched.
    pub matched: u32,
    /// Of those, the ones it resolved.
    pub resolved: u32,
}

/// Resolves the suggestions in `Repo` that events settle, checking lost access with
/// `Access`.
pub struct SuggestionResolution<Repo, Access> {
    repo: Arc<Repo>,
    access: Arc<Access>,
}

impl<Repo, Access> Clone for SuggestionResolution<Repo, Access> {
    fn clone(&self) -> Self {
        Self {
            repo: Arc::clone(&self.repo),
            access: Arc::clone(&self.access),
        }
    }
}

impl<Repo: SuggestionRepo, Access: SuggestionAccess> SuggestionResolution<Repo, Access> {
    /// Resolution over `repo`, checking access with `access`.
    pub fn new(repo: Arc<Repo>, access: Arc<Access>) -> Self {
        Self { repo, access }
    }

    /// The open suggestions `event` matches, once each.
    async fn matched(
        &self,
        event: &ResolutionEvent,
    ) -> Result<Vec<(Uuid, MacroUserIdStr<'static>)>, SuggestionError> {
        let item = event.item();
        let open = self
            .repo
            .open_about(item.entity_type, &item.entity_id)
            .await
            .map_err(SuggestionError::internal)?;

        let mut seen = HashSet::new();
        Ok(open
            .into_iter()
            .filter(|target| event.settles(target))
            .filter(|target| seen.insert(target.suggestion))
            .map(|target| (target.suggestion, target.user))
            .collect())
    }

    /// Of `suggestions`, the ones whose person can no longer open `item`.
    async fn without_access(
        &self,
        item: &Item,
        suggestions: Vec<(Uuid, MacroUserIdStr<'static>)>,
    ) -> Result<Vec<(Uuid, MacroUserIdStr<'static>)>, SuggestionError> {
        let target = Target {
            entity_type: item.entity_type,
            entity_id: item.entity_id.clone(),
            part_id: None,
        };
        let mut viewable = HashMap::new();
        let mut lost = Vec::new();
        for (suggestion, user) in suggestions {
            let can_view = match viewable.get(&user) {
                Some(can_view) => *can_view,
                None => {
                    let can_view = self
                        .access
                        .can_view(&user, &target)
                        .await
                        .map_err(SuggestionError::internal)?;
                    viewable.insert(user.clone(), can_view);
                    can_view
                }
            };
            if !can_view {
                lost.push((suggestion, user));
            }
        }
        Ok(lost)
    }
}

impl<Repo: SuggestionRepo, Access: SuggestionAccess> ResolveSuggestions
    for SuggestionResolution<Repo, Access>
{
    #[tracing::instrument(
        name = "suggestions.resolve",
        err,
        skip_all,
        fields(
            suggestions.event.kind = event.kind(),
            entity.type = event.item().entity_type.as_ref(),
            entity.id = %event.item().entity_id,
            suggestions.matched,
            suggestions.resolved,
            outcome,
        )
    )]
    async fn resolve(&self, event: &ResolutionEvent) -> Result<Resolved, SuggestionError> {
        let matched = self.matched(event).await?;
        let count = u32::try_from(matched.len()).unwrap_or(u32::MAX);
        let settled = match event {
            ResolutionEvent::AccessChanged { item, .. } => {
                self.without_access(item, matched).await?
            }
            ResolutionEvent::Replied { .. } | ResolutionEvent::Deleted { .. } => matched,
        };

        let now = Utc::now();
        let mut resolved = 0;
        for (suggestion, user) in settled {
            let moved = self
                .repo
                .resolve(&user, suggestion, event.reason(), now)
                .await
                .map_err(SuggestionError::internal)?;
            resolved += u32::from(moved);
        }

        let outcome = if resolved > 0 {
            "resolved"
        } else if count > 0 {
            "unchanged"
        } else {
            "no_match"
        };
        let span = tracing::Span::current();
        span.record("suggestions.matched", count);
        span.record("suggestions.resolved", resolved);
        span.record("outcome", outcome);
        Ok(Resolved {
            matched: count,
            resolved,
        })
    }
}
