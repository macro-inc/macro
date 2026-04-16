use std::collections::HashMap;
use std::pin::Pin;

use chrono::Utc;
use futures::StreamExt;
use futures::stream::FuturesUnordered;
use macro_uuid::Uuid;
use tokio::sync::mpsc::{Receiver, Sender};

use crate::domain::models::{DispatchEvent, InProgressExecution, ScheduledAction};
use crate::domain::ports::{ScheduledActionDispatcher, ScheduledActionExecutor};

const BUFFER_SIZE: usize = 1024;

type SleepFuture = Pin<Box<dyn Future<Output = (Uuid, u64)> + Send>>;

struct TrackedAction {
    action: ScheduledAction,
    generation: u64,
}

pub struct TokioDispatcher<Exe: ScheduledActionExecutor> {
    executor: Exe,
}

impl<Exe: ScheduledActionExecutor> TokioDispatcher<Exe> {
    pub fn new(executor: Exe) -> Self {
        Self { executor }
    }
}

fn action_sleep(id: Uuid, action: &ScheduledAction, generation: u64) -> Option<SleepFuture> {
    if !action.enabled {
        return None;
    }

    let cron = action.schedule.as_cron();
    let next = cron.upcoming(action.timezone).next()?;
    let now = Utc::now().with_timezone(&action.timezone);
    let duration = (next - now).to_std().unwrap_or(std::time::Duration::ZERO);

    Some(Box::pin(async move {
        tokio::time::sleep(duration).await;
        (id, generation)
    }))
}

impl<Exe> ScheduledActionDispatcher for TokioDispatcher<Exe>
where
    Exe: ScheduledActionExecutor + Send + 'static,
{
    fn begin_dispatch_loop(self) -> (Sender<DispatchEvent>, Receiver<InProgressExecution>) {
        let (tx, mut rx) = tokio::sync::mpsc::channel(BUFFER_SIZE);
        let (extx, exrx) = tokio::sync::mpsc::channel::<InProgressExecution>(BUFFER_SIZE);

        tokio::spawn(async move {
            let mut actions: HashMap<Uuid, TrackedAction> = HashMap::new();
            let mut futures: FuturesUnordered<SleepFuture> = FuturesUnordered::new();

            loop {
                tokio::select! {
                    Some((id, generation)) = futures.next() => {
                        let Some(tracked) = actions.get(&id) else {
                            continue;
                        };
                        if tracked.generation != generation {
                            continue;
                        }

                        let action = tracked.action.clone();
                        match self.executor.execute_action(action).await {
                            Ok(execution) => {
                                let _ = extx.send(execution).await;
                            }
                            Err(e) => {
                                tracing::error!(error=?e, action_id=?id, "failed to execute scheduled action");
                            }
                        }

                        if let Some(tracked) = actions.get(&id)
                            && let Some(fut) = action_sleep(id, &tracked.action, tracked.generation) {
                                futures.push(fut);
                        }
                    }
                    Some(event) = rx.recv() => {
                        match event {
                            DispatchEvent::Create(action) => {
                                let Some(id) = action.id else { continue };
                                let generation = 0u64;
                                if let Some(fut) = action_sleep(id, &action, generation) {
                                    futures.push(fut);
                                }
                                actions.insert(id, TrackedAction { action, generation });
                            }
                            DispatchEvent::Update(action) => {
                                let Some(id) = action.id else { continue };
                                let generation = actions
                                    .get(&id)
                                    .map(|t| t.generation + 1)
                                    .unwrap_or(0);
                                if let Some(fut) = action_sleep(id, &action, generation) {
                                    futures.push(fut);
                                }
                                actions.insert(id, TrackedAction { action, generation });
                            }
                            DispatchEvent::Delete(action) => {
                                let Some(id) = action.id else { continue };
                                actions.remove(&id);
                            }
                        }
                    }
                    else => break,
                }
            }
        });

        (tx, exrx)
    }
}
