//! Composition-level scheduling and shutdown of fenced per-account actors.
use imap_engine::domain::{models::Binding, service::Engine};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::task::JoinHandle;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

struct RunningAccount {
    sync_generation: i64,
    grant_generation: i64,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
}

pub(crate) async fn run(engine: Arc<Engine>, cancellation: CancellationToken, tasks: TaskTracker) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut owners = HashMap::<Uuid, RunningAccount>::new();
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            _ = interval.tick() => {},
        }
        schedule_round(&engine, &cancellation, &tasks, &mut owners).await;
    }
    for owner in owners.into_values() {
        owner.cancellation.cancel();
    }
}

#[tracing::instrument(skip_all, name = "imap.schedule_accounts", fields(
    scheduler.owned = tracing::field::Empty,
    scheduler.admitted = tracing::field::Empty,
    scheduler.new_candidates = tracing::field::Empty,
))]
async fn schedule_round(
    engine: &Arc<Engine>,
    cancellation: &CancellationToken,
    tasks: &TaskTracker,
    owners: &mut HashMap<Uuid, RunningAccount>,
) {
    let retained_links = owners
        .iter()
        .filter(|(_, owner)| !owner.task.is_finished())
        .map(|(link, _)| *link)
        .collect::<Vec<_>>();
    let bindings = match engine.bindings(&retained_links).await {
        Ok(bindings) => bindings,
        Err(error) => {
            tracing::warn!(?error, "IMAP account scheduling unavailable");
            return;
        }
    };
    owners.retain(|link, owner| {
        let keep = !owner.task.is_finished()
            && bindings.iter().any(|binding| {
                binding.link_id == *link
                    && binding.sync_generation == owner.sync_generation
                    && binding.grant_generation == owner.grant_generation
            });
        if !keep {
            owner.cancellation.cancel();
        }
        keep
    });
    let pending = pending_bindings(bindings, owners);
    let span = tracing::Span::current();
    span.record("scheduler.owned", owners.len());
    span.record("scheduler.admitted", pending.len());
    for binding in pending {
        let stopped = cancellation.child_token();
        let actor_stopped = stopped.clone();
        let actor_engine = engine.clone();
        let task = tasks.spawn(
            async move {
                let _ = actor_engine
                    .run_account(binding, actor_stopped)
                    .await
                    .inspect_err(|error| tracing::warn!(?error, link_id = %binding.link_id, "IMAP account stopped"));
            },
        );
        owners.insert(
            binding.link_id,
            RunningAccount {
                sync_generation: binding.sync_generation,
                grant_generation: binding.grant_generation,
                cancellation: stopped,
                task,
            },
        );
    }
}

pub(crate) async fn configuration_notifications(
    mut listener: sqlx::postgres::PgListener,
    engine: Arc<Engine>,
    cancellation: CancellationToken,
) {
    loop {
        let notification = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = listener.recv() => result,
        };
        match notification {
            Ok(notification) => {
                if let Ok(link) = notification.payload().parse::<Uuid>() {
                    engine.wake_account(link);
                }
            }
            Err(error) => {
                tracing::warn!(?error, "IMAP configuration notification connection lost");
                // PgListener reconnects on the next receive; pace failed reconnects while DB is unavailable.
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                }
            }
        }
    }
}

// Select the entire pending batch before adding new actors to the owner map.
fn pending_bindings(
    bindings: Vec<Binding>,
    owners: &HashMap<Uuid, RunningAccount>,
) -> Vec<Binding> {
    let new = bindings
        .iter()
        .filter(|binding| !owners.contains_key(&binding.link_id))
        .count();
    tracing::Span::current().record("scheduler.new_candidates", new);
    bindings
        .into_iter()
        .filter(|binding| !owners.contains_key(&binding.link_id))
        .take(imap_engine::domain::models::AccountCapacity::DEFAULT.new_admissions(owners.len()))
        .collect()
}

#[cfg(test)]
mod test;
