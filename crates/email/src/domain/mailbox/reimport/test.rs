use super::*;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

/// Answers from a script and records every call by link name.
#[derive(Default)]
struct Script {
    names: HashMap<Uuid, &'static str>,
    states: HashMap<Uuid, LinkReimport>,
    refused_restarts: Vec<Uuid>,
    progress: Mutex<VecDeque<PhaseProgress>>,
    calls: Mutex<Vec<String>>,
}

impl Script {
    fn link(&mut self, name: &'static str, state: impl FnOnce(MailboxKey) -> LinkReimport) -> Uuid {
        let link_id = macro_uuid::generate_uuid_v7();
        self.names.insert(link_id, name);
        self.states.insert(
            link_id,
            state(MailboxKey {
                link_id,
                sync_generation: 1,
                grant_generation: 1,
            }),
        );
        link_id
    }

    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }
}

fn due(inbox_and_sent: i64, other_folders: i64) -> impl FnOnce(MailboxKey) -> LinkReimport {
    move |mailbox| LinkReimport::Due {
        mailbox,
        inbox_and_sent,
        other_folders,
        provider_items: Some(500),
    }
}

impl FolderReimportRepository for std::sync::Arc<Script> {
    async fn outlook_links(&self) -> Result<Vec<Uuid>, MailboxError> {
        Ok(self.names.keys().copied().collect())
    }
    async fn link_reimport(&self, link_id: Uuid, _: i16) -> Result<LinkReimport, MailboxError> {
        self.record(format!("check {}", self.names[&link_id]));
        Ok(self.states[&link_id].clone())
    }
    async fn restart_folders(
        &self,
        mailbox: MailboxKey,
        phase: ReimportPhase,
        _: i16,
        last_phase: bool,
    ) -> Result<Option<u64>, MailboxError> {
        let phase: &'static str = phase.into();
        let last = if last_phase { " last" } else { "" };
        self.record(format!(
            "restart {} {phase}{last}",
            self.names[&mailbox.link_id]
        ));
        Ok((!self.refused_restarts.contains(&mailbox.link_id)).then_some(1))
    }
    async fn phase_progress(&self, mailbox: MailboxKey) -> Result<PhaseProgress, MailboxError> {
        self.record(format!("progress {}", self.names[&mailbox.link_id]));
        Ok(self
            .progress
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(PhaseProgress::Settled))
    }
}

#[tokio::test(start_paused = true)]
async fn each_link_finishes_inbox_and_sent_then_the_rest_before_the_next_starts() {
    let mut script = Script::default();
    let second = script.link("second", due(2, 3));
    let first = script.link("first", due(0, 4));
    let inbox_only = script.link("inbox-only", due(1, 0));
    script.progress = Mutex::new(VecDeque::from([
        PhaseProgress::Running,
        PhaseProgress::Running,
        PhaseProgress::Settled,
    ]));
    let script = std::sync::Arc::new(script);
    let service = FolderReimportService::new(script.clone(), 1);

    let outcomes = service
        .run(vec![second, first, inbox_only], 1, ReimportMode::Apply)
        .await;

    assert_eq!(
        outcomes
            .into_iter()
            .map(|(link, outcome)| (link, outcome.unwrap()))
            .collect::<Vec<_>>(),
        vec![
            (second, LinkOutcome::Reimported),
            (first, LinkOutcome::Reimported),
            (inbox_only, LinkOutcome::Reimported),
        ]
    );
    assert_eq!(
        *script.calls.lock().unwrap(),
        [
            "check second",
            "restart second inbox_and_sent",
            "progress second",
            "progress second",
            "progress second",
            "restart second other_folders last",
            "progress second",
            "check first",
            "restart first other_folders last",
            "progress first",
            "check inbox-only",
            "restart inbox-only inbox_and_sent last",
            "progress inbox-only",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_dry_run_and_links_that_are_not_due_restart_nothing() {
    let mut script = Script::default();
    let current = script.link("current", |_| LinkReimport::Current);
    let importing = script.link("importing", |_| LinkReimport::Importing);
    let paused = script.link("paused", |_| LinkReimport::Inactive);
    let gmail = script.link("gmail", |_| LinkReimport::NotOutlook);
    let truncated = script.link("truncated", due(2, 2));
    let script = std::sync::Arc::new(script);
    let service = FolderReimportService::new(script.clone(), 1);

    let outcomes = service
        .run(
            vec![current, importing, paused, gmail, truncated],
            3,
            ReimportMode::Verify,
        )
        .await;

    let mut outcomes = outcomes
        .into_iter()
        .map(|(link, outcome)| (link, outcome.unwrap()))
        .collect::<Vec<_>>();
    outcomes.sort_by_key(|(link, _)| *link);
    let mut expected = vec![
        (current, LinkOutcome::Current),
        (importing, LinkOutcome::Importing),
        (paused, LinkOutcome::Inactive),
        (gmail, LinkOutcome::NotOutlook),
        (truncated, LinkOutcome::Planned),
    ];
    expected.sort_by_key(|(link, _)| *link);
    assert_eq!(outcomes, expected);
    assert!(
        script
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| call.starts_with("check ")),
        "nothing but checks ran"
    );
}

#[tokio::test(start_paused = true)]
async fn a_link_that_changes_or_stops_syncing_keeps_its_other_folders() {
    let mut script = Script::default();
    let reconnected = script.link("reconnected", due(1, 1));
    let reauth = script.link("reauth", due(1, 1));
    script.refused_restarts.push(reconnected);
    script.progress = Mutex::new(VecDeque::from([PhaseProgress::Interrupted]));
    let script = std::sync::Arc::new(script);
    let service = FolderReimportService::new(script.clone(), 1);

    let outcomes = service
        .run(vec![reconnected, reauth], 1, ReimportMode::Apply)
        .await;

    assert_eq!(
        outcomes
            .into_iter()
            .map(|(link, outcome)| (link, outcome.unwrap()))
            .collect::<Vec<_>>(),
        vec![
            (reconnected, LinkOutcome::Changed),
            (reauth, LinkOutcome::Interrupted)
        ]
    );
    assert_eq!(
        *script.calls.lock().unwrap(),
        [
            "check reconnected",
            "restart reconnected inbox_and_sent",
            "check reauth",
            "restart reauth inbox_and_sent",
            "progress reauth",
        ]
    );
}
