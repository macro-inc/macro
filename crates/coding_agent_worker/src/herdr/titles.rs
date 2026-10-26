//! Keep native tab labels aligned with Macro's generated and edited session names.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

use super::cli::{HerdrCli, Window};
use super::hub::title_from;
use super::store::{Record, Store};
use crate::outbound::stream::EventStreamClient;

#[cfg(test)]
mod test;

const REFRESH: Duration = Duration::from_secs(5);

pub(crate) struct TitleSync {
    client: EventStreamClient,
    cli: HerdrCli,
    state_dir: PathBuf,
    worktrees: PathBuf,
    applied: HashMap<String, (Window, String)>,
}

impl TitleSync {
    pub fn new(
        client: EventStreamClient,
        cli: HerdrCli,
        state_dir: PathBuf,
        worktrees: PathBuf,
    ) -> Self {
        Self {
            client,
            cli,
            state_dir,
            worktrees,
            applied: HashMap::new(),
        }
    }

    pub fn start(mut self, cancel: CancellationToken) -> AbortOnDropHandle<()> {
        AbortOnDropHandle::new(tokio::spawn(
            async move {
                let mut interval = tokio::time::interval(REFRESH);
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                let mut failed = false;
                loop {
                    tokio::select! {
                        () = cancel.cancelled() => break,
                        _ = interval.tick() => {}
                    }
                    let result = tokio::select! {
                        () = cancel.cancelled() => break,
                        result = tokio::time::timeout(REFRESH, self.refresh()) => result,
                    };
                    if matches!(result, Ok(Ok(()))) {
                        failed = false;
                    } else if !failed {
                        tracing::warn!(
                            "session title sync failed; retaining existing tab names and retrying"
                        );
                        failed = true;
                    }
                }
            }
            .instrument(tracing::info_span!("macrod.title_sync")),
        ))
    }

    #[tracing::instrument(name = "macrod.refresh_titles", skip_all, err)]
    async fn refresh(&mut self) -> rootcause::Result<()> {
        let records = Store(self.state_dir.clone()).list()?;
        if !records.iter().any(|record| record.window.is_some()) {
            return Ok(());
        }
        let sessions = self.client.sessions().await?;
        let mut failure = None;
        for session in sessions {
            let cwd = self.worktrees.join(session.session_id.to_string());
            let Some(title) = title_from(&session.name) else {
                continue;
            };
            for record in records.iter().filter(|record| record.cwd == cwd) {
                if let Err(error) = self.apply(record, &title).await {
                    failure = Some(error);
                }
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    #[tracing::instrument(name = "macrod.rename_tab", skip_all, fields(session_id = %record.id), err)]
    async fn apply(&mut self, record: &Record, title: &str) -> rootcause::Result<()> {
        let Some(window) = &record.window else {
            return Ok(());
        };
        let Some(current) = self.cli.current_window(window, &record.cwd).await? else {
            return Ok(());
        };
        if self
            .applied
            .get(&record.id)
            .is_some_and(|(previous, name)| previous == &current && name == title)
        {
            return Ok(());
        }
        self.cli.rename_tab(&current.tab_id, title).await?;
        self.applied
            .insert(record.id.clone(), (current, title.to_owned()));
        Ok(())
    }
}
