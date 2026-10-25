use std::time::Duration;

use macro_user_id::cowlike::CowLike;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::*;
use crate::domain::models::{ImportEntity, RunStatus};
use crate::domain::ports::{PlanRow, Result};

/// Hands every recorded scan to the test, with when it was written.
struct Recorder(mpsc::UnboundedSender<(Instant, ScanCounts)>);

impl NotionPlanRepo for Recorder {
    async fn replace_plan(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: &[PlanRow],
    ) -> Result<Vec<ImportEntity>> {
        unreachable!("recording a scan never replaces the plan")
    }

    async fn update_plan_rows(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: &[PlanRow],
    ) -> Result<u64> {
        unreachable!("recording a scan never decides plan rows")
    }

    async fn attach_review(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: Uuid,
        _: agent_session::domain::model::AgentSessionId,
    ) -> Result<u64> {
        unreachable!("recording a scan never attaches a review")
    }

    async fn transition_run(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: &[RunStatus],
        _: RunStatus,
        _: Option<&str>,
    ) -> Result<bool> {
        unreachable!("recording a scan never moves the run")
    }

    async fn team_copies(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[String],
    ) -> Result<Vec<ImportEntity>> {
        unreachable!("recording a scan never reads team copies")
    }

    async fn set_plan_sharing(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Uuid],
        _: &[Uuid],
    ) -> Result<u64> {
        unreachable!("recording a scan never changes sharing")
    }

    async fn claim_importing(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Uuid],
        _: &[Uuid],
        _: Option<Uuid>,
    ) -> Result<Vec<ImportEntity>> {
        unreachable!("recording a scan never claims rows")
    }

    async fn claim_team_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: Uuid,
        _: bool,
    ) -> Result<crate::domain::models::TeamClaim> {
        unreachable!("recording a scan never claims objects")
    }

    async fn wait_on(&self, _: &MacroUserIdStr<'static>, _: Uuid, _: Uuid) -> Result<bool> {
        unreachable!("recording a scan never waits")
    }

    async fn record_scan(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        scanned: ScanCounts,
    ) -> Result<bool> {
        assert_eq!(source, ImportSource::Notion);
        self.0.send((Instant::now(), scanned)).unwrap();
        Ok(true)
    }
}

#[tokio::test(start_paused = true)]
async fn scan_counts_are_written_at_most_every_two_seconds_and_once_at_the_end() {
    let user = MacroUserIdStr::parse_from_str("macro|owner@acme.test")
        .unwrap()
        .into_owned();
    let (writes, mut written) = mpsc::unbounded_channel();
    let repo = Recorder(writes);
    let (counts, scanned) = watch::channel(ScanCounts::default());

    let walk = async {
        counts.send_replace(ScanCounts {
            pages: 100,
            data_sources: 0,
        });
        let (first_at, first) = written.recv().await.unwrap();
        assert_eq!(
            first,
            ScanCounts {
                pages: 100,
                data_sources: 0,
            }
        );

        // Two search pages inside the throttle window: only the newest is
        // written, once the window has passed.
        counts.send_replace(ScanCounts {
            pages: 200,
            data_sources: 0,
        });
        counts.send_replace(ScanCounts {
            pages: 200,
            data_sources: 7,
        });
        let (second_at, second) = written.recv().await.unwrap();
        assert_eq!(
            second,
            ScanCounts {
                pages: 200,
                data_sources: 7,
            }
        );
        assert_eq!(second_at - first_at, Duration::from_secs(2));

        // The final counts are written as soon as the inventory ends, without
        // waiting out the window.
        counts.send_replace(ScanCounts {
            pages: 180,
            data_sources: 7,
        });
        drop(counts);
        second_at
    };
    let (second_at, ()) = tokio::join!(walk, record_scan(&repo, &user, scanned));

    let (last_at, last) = written.recv().await.unwrap();
    assert_eq!(
        last,
        ScanCounts {
            pages: 180,
            data_sources: 7,
        }
    );
    assert_eq!(last_at, second_at);
    assert!(written.try_recv().is_err());
}
