//! Composition-level scheduling and shutdown of fenced per-account actors.
use imap_engine::domain::{models::Binding, service::Engine};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::oneshot, task::JoinHandle};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

pub(crate) const POLL_INTERVAL: Duration = Duration::from_secs(30);

struct RunningAccount {
    sync_generation: i64,
    grant_generation: i64,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
}

pub(crate) async fn run(
    engine: Arc<Engine>,
    cancellation: CancellationToken,
    tasks: TaskTracker,
    first_binding: oneshot::Sender<()>,
) {
    let mut first_binding = Some(first_binding);
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut owners = HashMap::<Uuid, RunningAccount>::new();
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            _ = interval.tick() => {},
        }
        schedule_round(
            &engine,
            &cancellation,
            &tasks,
            &mut owners,
            &mut first_binding,
        )
        .await;
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
    first_binding: &mut Option<oneshot::Sender<()>>,
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
    start_listener_for_bindings(&bindings, first_binding);
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
    pool: sqlx::PgPool,
    first_binding: oneshot::Receiver<()>,
    engine: Arc<Engine>,
    cancellation: CancellationToken,
) {
    // The scheduler's thirty-second poll discovers the first enrollment even
    // before LISTEN exists. Once needed, retain one listener until shutdown.
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => return,
        result = first_binding => if result.is_err() { return; },
    }
    let mut listener = loop {
        let connect = async {
            let mut listener = sqlx::postgres::PgListener::connect_with(&pool).await?;
            listener.listen("imap_config_changed").await?;
            Ok::<_, sqlx::Error>(listener)
        };
        let result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = connect => result,
        };
        match result {
            Ok(listener) => break listener,
            Err(error) => {
                tracing::warn!(?error, "IMAP configuration listener unavailable");
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {},
                }
            }
        }
    };
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

// This is a one-way signal: a replica that has ever served an account keeps
// listening even if the next scheduler round is empty.
fn start_listener_for_bindings(
    bindings: &[Binding],
    first_binding: &mut Option<oneshot::Sender<()>>,
) {
    if !bindings.is_empty()
        && let Some(start) = first_binding.take()
    {
        let _ = start.send(());
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
