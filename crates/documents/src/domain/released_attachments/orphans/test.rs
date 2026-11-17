use super::*;
use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
#[error("database unavailable")]
struct Unavailable;

/// Hands out the scripted pages in order and records every call.
#[derive(Default)]
struct ScriptedRepo {
    pages: Mutex<VecDeque<Result<OrphanPage, Unavailable>>>,
    depths: Mutex<VecDeque<i64>>,
    asked_after: Mutex<Vec<String>>,
    previewed: Mutex<Vec<Vec<String>>>,
    enqueued: Mutex<Vec<Vec<String>>>,
    notifications: Mutex<usize>,
}

impl ScriptedRepo {
    fn new(pages: Vec<Result<OrphanPage, Unavailable>>) -> Self {
        Self {
            pages: Mutex::new(pages.into()),
            ..Self::default()
        }
    }
}

impl OrphanedAttachmentRepo for ScriptedRepo {
    type Err = Unavailable;

    async fn orphan_page(
        &self,
        after: &str,
        _page_size: NonZeroU32,
    ) -> Result<OrphanPage, Self::Err> {
        self.asked_after
            .lock()
            .expect("asked lock")
            .push(after.to_string());
        self.pages
            .lock()
            .expect("pages lock")
            .pop_front()
            .unwrap_or_else(|| Ok(OrphanPage::default()))
    }

    /// The first document of each preview is adopted, the rest would go to
    /// the Trash.
    async fn preview_drain(&self, document_ids: &[String]) -> Result<ReleasedBatch, Self::Err> {
        self.previewed
            .lock()
            .expect("previewed lock")
            .push(document_ids.to_vec());
        Ok(ReleasedBatch {
            claimed: document_ids.len(),
            trashed: document_ids[1..].to_vec(),
            kept: document_ids[..1].to_vec(),
            adopted: 1,
            ..ReleasedBatch::default()
        })
    }

    async fn enqueue(&self, document_ids: &[String]) -> Result<usize, Self::Err> {
        self.enqueued
            .lock()
            .expect("enqueued lock")
            .push(document_ids.to_vec());
        Ok(document_ids.len())
    }

    async fn notify_drain(&self) -> Result<(), Self::Err> {
        *self.notifications.lock().expect("notifications lock") += 1;
        Ok(())
    }

    async fn queue_depth(&self) -> Result<i64, Self::Err> {
        Ok(self
            .depths
            .lock()
            .expect("depths lock")
            .pop_front()
            .unwrap_or(0))
    }
}

#[derive(Default)]
struct RecordingStore(Mutex<Vec<ScanProgress>>);

impl ScanProgressStore for RecordingStore {
    type Err = Unavailable;

    async fn save(&self, progress: &ScanProgress) -> Result<(), Self::Err> {
        self.0.lock().expect("saved lock").push(progress.clone());
        Ok(())
    }
}

impl RecordingStore {
    fn cursors(&self) -> Vec<(Option<String>, usize, bool)> {
        self.0
            .lock()
            .expect("saved lock")
            .iter()
            .map(|progress| (progress.after.clone(), progress.pages, progress.finished))
            .collect()
    }
}

const OPTIONS: ScanOptions = ScanOptions {
    page_size: NonZeroU32::new(500).expect("500 is not zero"),
    per_second: NonZeroU32::MAX,
    max_queue_depth: 10_000,
};

#[tokio::test(start_paused = true)]
async fn a_dry_run_counts_orphans_by_cause_and_what_the_drain_would_do() {
    let repo = ScriptedRepo::new(vec![
        Ok(OrphanPage {
            last_entity_id: Some("e2".to_string()),
            // Each fact decides only when the ones before it hold.
            orphans: vec![
                Orphan {
                    document_id: "d1".to_string(),
                    source_from_import: true,
                    mailbox_kept: false,
                    mailbox_predates_document: true,
                    thread_kept: true,
                    message_kept: true,
                },
                Orphan {
                    document_id: "d2".to_string(),
                    source_from_import: true,
                    mailbox_kept: true,
                    mailbox_predates_document: false,
                    thread_kept: false,
                    message_kept: false,
                },
                Orphan {
                    document_id: "d3".to_string(),
                    source_from_import: true,
                    mailbox_kept: true,
                    mailbox_predates_document: true,
                    thread_kept: false,
                    message_kept: true,
                },
            ],
        }),
        Ok(OrphanPage {
            last_entity_id: Some("e5".to_string()),
            orphans: vec![
                Orphan {
                    document_id: "d4".to_string(),
                    source_from_import: true,
                    mailbox_kept: true,
                    mailbox_predates_document: true,
                    thread_kept: true,
                    message_kept: false,
                },
                Orphan {
                    document_id: "d5".to_string(),
                    source_from_import: true,
                    mailbox_kept: true,
                    mailbox_predates_document: true,
                    thread_kept: true,
                    message_kept: true,
                },
            ],
        }),
    ]);
    let store = RecordingStore::default();
    let scan = OrphanedAttachmentScan::new(repo, store);

    let done = scan
        .run(OPTIONS, ScanProgress::start(false, None))
        .await
        .expect("scan");

    assert_eq!(
        done,
        ScanProgress {
            apply: false,
            after: Some("e5".to_string()),
            pages: 3,
            finished: true,
            counts: ScanCounts {
                orphans: 5,
                mailbox_gone: 1,
                mailbox_recreated: 1,
                thread_gone: 1,
                message_gone: 1,
                attachment_replaced: 1,
                would_trash: 3,
                would_keep_adopted: 2,
                ..ScanCounts::default()
            },
        }
    );
    assert_eq!(
        *scan.repo.asked_after.lock().expect("asked lock"),
        vec!["", "e2", "e5"]
    );
    assert_eq!(
        *scan.repo.previewed.lock().expect("previewed lock"),
        vec![vec!["d1", "d2", "d3"], vec!["d4", "d5"]]
    );
    assert!(scan.repo.enqueued.lock().expect("enqueued lock").is_empty());
    assert_eq!(
        *scan.repo.notifications.lock().expect("notifications lock"),
        0
    );
    assert_eq!(
        scan.store.cursors(),
        vec![
            (Some("e2".to_string()), 1, false),
            (Some("e5".to_string()), 2, false),
            (Some("e5".to_string()), 3, true),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn an_applied_scan_queues_each_page_at_its_rate_and_wakes_the_drain_per_batch() {
    let page = |last: &str, prefix: &str, count: usize| {
        Ok(OrphanPage {
            last_entity_id: Some(last.to_string()),
            orphans: (0..count)
                .map(|n| Orphan {
                    document_id: format!("{prefix}{n:03}"),
                    source_from_import: true,
                    mailbox_kept: false,
                    mailbox_predates_document: false,
                    thread_kept: false,
                    message_kept: false,
                })
                .collect(),
        })
    };
    let repo = ScriptedRepo::new(vec![
        page("e1", "a", 300),
        page("e2", "b", 300),
        page("e3", "c", 10),
    ]);
    let scan = OrphanedAttachmentScan::new(repo, RecordingStore::default());
    let options = ScanOptions {
        per_second: NonZeroU32::new(100).expect("100 is not zero"),
        ..OPTIONS
    };
    let started = Instant::now();

    let done = scan
        .run(options, ScanProgress::start(true, None))
        .await
        .expect("scan");

    assert_eq!(done.counts.orphans, 610);
    assert_eq!(done.counts.enqueued, 610);
    assert_eq!(done.counts.already_queued, 0);
    assert!(done.finished);
    let enqueued = scan.repo.enqueued.lock().expect("enqueued lock");
    assert_eq!(
        enqueued.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![300, 300, 10]
    );
    assert!(
        scan.repo
            .previewed
            .lock()
            .expect("previewed lock")
            .is_empty()
    );
    // Once 600 were waiting, and once for the last 10 when the walk ended.
    assert_eq!(
        *scan.repo.notifications.lock().expect("notifications lock"),
        2
    );
    // 610 documents at 100 a second.
    assert_eq!(started.elapsed(), Duration::from_millis(6_100));
}

#[tokio::test(start_paused = true)]
async fn a_scan_resumes_after_its_saved_cursor_with_its_saved_counts() {
    let repo = ScriptedRepo::new(vec![Ok(OrphanPage {
        last_entity_id: Some("e9".to_string()),
        orphans: vec![Orphan {
            document_id: "d9".to_string(),
            source_from_import: true,
            mailbox_kept: true,
            mailbox_predates_document: true,
            thread_kept: false,
            message_kept: false,
        }],
    })]);
    let scan = OrphanedAttachmentScan::new(repo, RecordingStore::default());
    let saved = ScanProgress {
        apply: true,
        after: Some("e5".to_string()),
        pages: 2,
        finished: false,
        counts: ScanCounts {
            orphans: 4,
            mailbox_gone: 4,
            enqueued: 3,
            already_queued: 1,
            ..ScanCounts::default()
        },
    };

    let done = scan.run(OPTIONS, saved).await.expect("scan");

    assert_eq!(
        *scan.repo.asked_after.lock().expect("asked lock"),
        vec!["e5", "e9"]
    );
    assert_eq!(done.pages, 4);
    assert_eq!(
        done.counts,
        ScanCounts {
            orphans: 5,
            mailbox_gone: 4,
            thread_gone: 1,
            enqueued: 4,
            already_queued: 1,
            ..ScanCounts::default()
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_page_stops_the_scan_at_the_last_saved_cursor_without_retrying() {
    let repo = ScriptedRepo::new(vec![
        Ok(OrphanPage {
            last_entity_id: Some("e2".to_string()),
            orphans: vec![Orphan {
                document_id: "d1".to_string(),
                source_from_import: true,
                mailbox_kept: false,
                mailbox_predates_document: false,
                thread_kept: false,
                message_kept: false,
            }],
        }),
        Err(Unavailable),
        Ok(OrphanPage {
            last_entity_id: Some("e4".to_string()),
            orphans: vec![Orphan {
                document_id: "d3".to_string(),
                source_from_import: true,
                mailbox_kept: false,
                mailbox_predates_document: false,
                thread_kept: false,
                message_kept: false,
            }],
        }),
    ]);
    let scan = OrphanedAttachmentScan::new(repo, RecordingStore::default());

    let stopped = scan
        .run(OPTIONS, ScanProgress::start(true, None))
        .await
        .expect_err("the second page fails");

    assert_eq!(stopped.progress.after.as_deref(), Some("e2"));
    assert_eq!(stopped.progress.pages, 1);
    assert_eq!(stopped.progress.counts.enqueued, 1);
    assert_eq!(
        *scan.repo.asked_after.lock().expect("asked lock"),
        vec!["", "e2"]
    );
    assert_eq!(
        scan.store.cursors(),
        vec![(Some("e2".to_string()), 1, false)]
    );
    // Fewer than a batch were queued and the walk did not end: the drain's
    // sweep picks them up.
    assert_eq!(
        *scan.repo.notifications.lock().expect("notifications lock"),
        0
    );
}

#[tokio::test(start_paused = true)]
async fn an_applied_scan_holds_back_while_the_queue_is_deeper_than_its_limit() {
    let repo = ScriptedRepo::new(vec![Ok(OrphanPage {
        last_entity_id: Some("e1".to_string()),
        orphans: vec![Orphan {
            document_id: "d1".to_string(),
            source_from_import: true,
            mailbox_kept: false,
            mailbox_predates_document: false,
            thread_kept: false,
            message_kept: false,
        }],
    })]);
    *repo.depths.lock().expect("depths lock") = VecDeque::from([12_000, 10_001, 10_000]);
    let scan = OrphanedAttachmentScan::new(repo, RecordingStore::default());
    let started = Instant::now();

    let done = scan
        .run(OPTIONS, ScanProgress::start(true, None))
        .await
        .expect("scan");

    // Two waits before the first page; the second page came within the
    // check interval and read nothing.
    assert_eq!(started.elapsed(), HOLD_BACK_INTERVAL * 2);
    assert!(scan.repo.depths.lock().expect("depths lock").is_empty());
    assert_eq!(done.counts.enqueued, 1);
    assert!(done.finished);
}

#[tokio::test(start_paused = true)]
async fn documents_whose_thread_source_was_set_by_hand_are_counted_apart_and_left_alone() {
    let page = || {
        Ok(OrphanPage {
            last_entity_id: Some("e3".to_string()),
            orphans: vec![
                Orphan {
                    document_id: "d1".to_string(),
                    source_from_import: true,
                    mailbox_kept: false,
                    mailbox_predates_document: false,
                    thread_kept: false,
                    message_kept: false,
                },
                Orphan {
                    document_id: "d2".to_string(),
                    source_from_import: false,
                    mailbox_kept: false,
                    mailbox_predates_document: false,
                    thread_kept: false,
                    message_kept: false,
                },
                Orphan {
                    document_id: "d3".to_string(),
                    source_from_import: true,
                    mailbox_kept: true,
                    mailbox_predates_document: true,
                    thread_kept: false,
                    message_kept: false,
                },
            ],
        })
    };
    let dry_run =
        OrphanedAttachmentScan::new(ScriptedRepo::new(vec![page()]), RecordingStore::default());
    let applied =
        OrphanedAttachmentScan::new(ScriptedRepo::new(vec![page()]), RecordingStore::default());

    let previewed = dry_run
        .run(OPTIONS, ScanProgress::start(false, None))
        .await
        .expect("dry run");
    let queued = applied
        .run(OPTIONS, ScanProgress::start(true, None))
        .await
        .expect("applied scan");

    assert_eq!(
        previewed.counts,
        ScanCounts {
            orphans: 2,
            source_not_from_import: 1,
            mailbox_gone: 1,
            thread_gone: 1,
            would_trash: 1,
            would_keep_adopted: 1,
            ..ScanCounts::default()
        }
    );
    assert_eq!(
        *dry_run.repo.previewed.lock().expect("previewed lock"),
        vec![vec!["d1", "d3"]]
    );
    assert_eq!(
        queued.counts,
        ScanCounts {
            orphans: 2,
            source_not_from_import: 1,
            mailbox_gone: 1,
            thread_gone: 1,
            enqueued: 2,
            ..ScanCounts::default()
        }
    );
    assert_eq!(
        *applied.repo.enqueued.lock().expect("enqueued lock"),
        vec![vec!["d1", "d3"]]
    );
}

/// Saves the first progress and fails every later save.
#[derive(Default)]
struct StoreFailingAfterFirstSave(Mutex<Vec<ScanProgress>>);

impl ScanProgressStore for StoreFailingAfterFirstSave {
    type Err = Unavailable;

    async fn save(&self, progress: &ScanProgress) -> Result<(), Self::Err> {
        let mut saved = self.0.lock().expect("saved lock");
        if !saved.is_empty() {
            return Err(Unavailable);
        }
        saved.push(progress.clone());
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn a_failed_save_stops_the_scan_at_the_cursor_the_store_holds() {
    let page = |last: &str| {
        Ok(OrphanPage {
            last_entity_id: Some(last.to_string()),
            orphans: Vec::new(),
        })
    };
    let repo = ScriptedRepo::new(vec![page("e1"), page("e2")]);
    let scan = OrphanedAttachmentScan::new(repo, StoreFailingAfterFirstSave::default());

    let stopped = scan
        .run(OPTIONS, ScanProgress::start(false, None))
        .await
        .expect_err("the second save fails");

    assert_eq!(stopped.progress.after.as_deref(), Some("e1"));
    assert_eq!(stopped.progress.pages, 1);
    assert_eq!(
        scan.store.0.lock().expect("saved lock")[0].after.as_deref(),
        Some("e1")
    );
}
