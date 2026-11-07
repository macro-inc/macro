use std::{marker::PhantomData, time::Duration};

use agent_session::domain::{
    error::AgentSessionError, model::AgentSessionId, work_registration::ENDED_REPORT_WINDOW,
};
use async_graphql::{Context, ID, Subscription};
use attention_feed::domain::{
    live::{COALESCE_WINDOW, coalesce},
    models::{FeedKey, FeedTrigger},
};
use chrono::{DateTime, Utc};
use futures::{Stream, StreamExt, future::join_all};
use graphql_common::require_authenticated_user;
use graphql_soup::{AgentSessionEntityLoader, SoupEntityEdges};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use soup_realtime_core::models::Patch;
use tokio::sync::mpsc::{self, Receiver};
use uuid::Uuid;

use crate::{
    context::RegisteredWorkGraphqlContext, inputs::parse_account_ids,
    objects::GraphqlRegisteredWorkPatch, query::load_entry,
};

/// Session changes buffered per subscriber before the source waits.
const TRIGGER_BUFFER: usize = 64;

/// How often a subscriber refetches regardless. A viewer who loses access hears nothing, since
/// session changes go to current accessors, so this bounds how long a revoked entry stays shown.
const REFRESH_INTERVAL: Duration = Duration::from_secs(2 * 60);

/// Root GraphQL adapter for the registered work subscription.
pub struct RegisteredWorkSubscriptionRoot<E>(PhantomData<fn() -> E>);

impl<E> Default for RegisteredWorkSubscriptionRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Subscription]
impl<E: SoupEntityEdges> RegisteredWorkSubscriptionRoot<E> {
    /// Changes to the registered work of `accountIds` that the authenticated
    /// user can see: entries to show, entries to stop showing, and an
    /// invalidation when changes may have been missed or sharing changed.
    /// Each payload is one batch to apply together. Start it before fetching
    /// `registeredWork` and refetch after an invalidation; the stream ends
    /// with an error when its source ends, after which the client resubscribes
    /// and refetches.
    async fn registered_work_updates(
        &self,
        ctx: &Context<'_>,
        account_ids: Vec<ID>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<Vec<GraphqlRegisteredWorkPatch<E>>>> + 'static,
    > {
        let viewer = require_authenticated_user(ctx)?;
        let context = ctx.data::<RegisteredWorkGraphqlContext>()?.clone();
        let loader = ctx.data::<AgentSessionEntityLoader>()?.clone();
        let accounts = parse_account_ids(account_ids)?;
        let ended_after = Utc::now() - ENDED_REPORT_WINDOW;
        let triggers = session_triggers(context.patches(viewer.clone()));

        Ok(async_stream::stream! {
            let batches = coalesce(triggers, COALESCE_WINDOW);
            futures::pin_mut!(batches);
            let mut refresh = tokio::time::interval_at(
                tokio::time::Instant::now() + REFRESH_INTERVAL,
                REFRESH_INTERVAL,
            );
            loop {
                let batch = tokio::select! {
                    _ = refresh.tick() => {
                        yield Ok(vec![GraphqlRegisteredWorkPatch::invalidate()]);
                        continue;
                    }
                    batch = batches.next() => batch,
                };
                let Some(batch) = batch else {
                    break;
                };
                if batch.invalidated {
                    yield Ok(vec![GraphqlRegisteredWorkPatch::invalidate()]);
                    continue;
                }
                let sessions = session_ids(&batch.keys);
                match session_patches::<E>(
                    &context,
                    &loader,
                    &viewer,
                    &accounts,
                    &sessions,
                    ended_after,
                )
                .await
                {
                    Ok(patches) if patches.is_empty() => {}
                    Ok(patches) => yield Ok(patches),
                    Err(error) => {
                        tracing::error!(error = ?error, "registered work recompute failed");
                        yield Ok(vec![GraphqlRegisteredWorkPatch::invalidate()]);
                    }
                }
            }
            yield Err(async_graphql::Error::new(
                "registered work subscription ended; resubscribe and refetch",
            ));
        })
    }
}

/// The session changes among a viewer's Soup patches. When the patches end, normally or after
/// falling behind, changes may have been missed, so subscribers must refetch.
fn session_triggers(mut patches: Receiver<Patch<Entity<'static>>>) -> Receiver<FeedTrigger> {
    let (sender, receiver) = mpsc::channel(TRIGGER_BUFFER);
    tokio::spawn(async move {
        loop {
            let patch = tokio::select! {
                () = sender.closed() => return,
                patch = patches.recv() => patch,
            };
            let Some(patch) = patch else {
                break;
            };
            let entity = patch.value();
            if entity.entity_type != EntityType::AgentSession {
                continue;
            }
            let trigger = FeedTrigger::Changed(vec![entity.clone()]);
            if sender.send(trigger).await.is_err() {
                return;
            }
        }
        let _ = sender.send(FeedTrigger::Invalidated).await;
    });
    receiver
}

/// The sessions a batch names. Only well-formed session ids reach here; any other is skipped.
fn session_ids(keys: &[FeedKey]) -> Vec<AgentSessionId> {
    keys.iter()
        .filter_map(|key| Uuid::parse_str(key.entity().entity_id.as_ref()).ok())
        .map(AgentSessionId::new_from_uuid)
        .collect()
}

/// What `sessions` changing means for `viewer`. Every entry passes the domain's view check and
/// the Soup access filter; a session failing either asks for a refetch rather than naming it.
#[tracing::instrument(
    name = "registered_work.stream.batch",
    err,
    skip_all,
    fields(sessions = sessions.len(), upserts, removes, refetch)
)]
async fn session_patches<E: SoupEntityEdges>(
    context: &RegisteredWorkGraphqlContext,
    loader: &AgentSessionEntityLoader,
    viewer: &MacroUserIdStr<'static>,
    accounts: &[MacroUserIdStr<'static>],
    sessions: &[AgentSessionId],
    ended_after: DateTime<Utc>,
) -> Result<Vec<GraphqlRegisteredWorkPatch<E>>, AgentSessionError> {
    let changes = context
        .service
        .changes(viewer, accounts, sessions, ended_after)
        .await?;

    let active = changes.active.len();
    let entries = changes
        .active
        .into_iter()
        .map(|registration| load_entry::<E>(loader, viewer, registration));
    let entries: Vec<_> = join_all(entries).await.into_iter().flatten().collect();
    let refetch = changes.refetch || entries.len() < active;

    let span = tracing::Span::current();
    span.record("upserts", entries.len());
    span.record("removes", changes.removed.len());
    span.record("refetch", refetch);

    let mut patches: Vec<_> = changes
        .removed
        .into_iter()
        .map(GraphqlRegisteredWorkPatch::remove)
        .collect();
    patches.extend(entries.into_iter().map(GraphqlRegisteredWorkPatch::upsert));
    if refetch {
        patches.push(GraphqlRegisteredWorkPatch::invalidate());
    }
    Ok(patches)
}
