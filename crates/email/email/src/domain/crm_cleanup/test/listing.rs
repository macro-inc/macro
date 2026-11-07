use super::*;
use chrono::TimeDelta;

#[tokio::test]
async fn finished_jobs_stop_before_page_reads_and_clock_reads() {
    for status in [CrmCleanupJobStatus::Complete, CrmCleanupJobStatus::Failed] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().job = Some(job(status));
        super::super::list_candidates::list_candidates(&service, JOB, 10)
            .await
            .unwrap();
        assert_eq!(fake.calls(), [Call::Job(JOB)]);
    }
}

#[tokio::test]
async fn both_active_states_process_an_empty_page_and_complete_without_counting() {
    for status in [CrmCleanupJobStatus::Init, CrmCleanupJobStatus::InProgress] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.job = Some(job(status));
            s.page.clear();
            s.sources.clear();
        }
        super::super::list_candidates::list_candidates(&service, JOB, 91)
            .await
            .unwrap();
        assert_eq!(
            fake.calls(),
            [
                Call::Job(JOB),
                Call::Page(91, 300, 200),
                Call::Now,
                Call::Pairs(vec![]),
                Call::Status(JOB, CrmCleanupJobStatus::Complete)
            ]
        );
    }
}

#[tokio::test]
async fn source_presence_and_young_age_independently_keep_original_pairs_in_order() {
    let (service, fake) = setup();
    let mut source = candidate(5, "MIXED@EXAMPLE.COM");
    source.created_at = now() - TimeDelta::hours(7);
    let mut young = candidate(9, "young@example.com");
    young.created_at = now() - TimeDelta::hours(6) + TimeDelta::nanoseconds(1);
    let mut both = candidate(10, "both@example.com");
    both.created_at = young.created_at;
    let mut neither = candidate(15, "old@example.com");
    neither.created_at = now() - TimeDelta::hours(6);
    let pairs = vec![
        (LINK, source.contact_email.clone()),
        (LINK, young.contact_email.clone()),
        (LINK, both.contact_email.clone()),
        (LINK, neither.contact_email.clone()),
    ];
    {
        let mut s = fake.0.lock().unwrap();
        s.page = vec![source, young, both, neither];
        s.sources = vec![
            (LINK, "mixed@example.com".into()),
            (LINK, "both@example.com".into()),
        ];
        s.batch_count = 0;
    }
    super::super::list_candidates::list_candidates(&service, JOB, 4)
        .await
        .unwrap();
    assert_eq!(
        fake.calls(),
        [
            Call::Job(JOB),
            Call::Page(4, 300, 200),
            Call::Now,
            Call::Pairs(pairs),
            Call::Prune(vec![(LINK, "old@example.com".into())]),
            Call::Send(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: "MIXED@EXAMPLE.COM".into()
            }),
            Call::Send(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: "young@example.com".into()
            }),
            Call::Send(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: "both@example.com".into()
            }),
            Call::Count(JOB, 3),
            Call::Status(JOB, CrmCleanupJobStatus::Complete)
        ]
    );
}

#[tokio::test]
async fn six_hour_prune_boundary_is_strict() {
    for delta in [-1, 0, 1] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.page[0].created_at = now() - TimeDelta::hours(6) + TimeDelta::nanoseconds(delta);
            s.sources.clear();
        }
        super::super::list_candidates::list_candidates(&service, JOB, 0)
            .await
            .unwrap();
        assert_eq!(
            fake.calls().iter().any(|x| matches!(x, Call::Prune(_))),
            delta <= 0
        );
        assert_eq!(
            fake.calls().iter().any(|x| matches!(x, Call::Send(_))),
            delta > 0
        );
    }
}

#[tokio::test]
async fn page_length_controls_continuation_even_when_every_row_is_pruned() {
    for count in [1, 199, 200] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.page = (1..=count).map(|id| candidate(id * 3, EMAIL)).collect();
            s.sources.clear();
        }
        super::super::list_candidates::list_candidates(&service, JOB, 0)
            .await
            .unwrap();
        let expected = if count == 200 {
            Call::Send(CrmCleanupOperation::ListCandidates {
                job_id: JOB,
                last_id: 600,
            })
        } else {
            Call::Status(JOB, CrmCleanupJobStatus::Complete)
        };
        assert_eq!(fake.calls().last(), Some(&expected));
        assert!(!fake.calls().iter().any(|x| matches!(x, Call::Count(_, _))));
    }
}

#[tokio::test]
async fn failed_middle_dispatch_keeps_pruning_and_prior_sends_without_counting_or_continuing() {
    let (service, fake) = setup();
    {
        let mut s = fake.0.lock().unwrap();
        s.page = vec![
            candidate(1, "old@example.com"),
            candidate(2, EMAIL),
            candidate(3, EMAIL),
        ];
        s.fault = Some(("send", 2));
    }
    retryable(
        super::super::list_candidates::list_candidates(&service, JOB, 0).await,
        FailureReason::SqsEnqueueFailed,
        "Failed to enqueue ProcessCandidate message",
    );
    assert_eq!(
        fake.calls(),
        [
            Call::Job(JOB),
            Call::Page(0, 300, 200),
            Call::Now,
            Call::Pairs(vec![
                (LINK, "old@example.com".into()),
                (LINK, EMAIL.into()),
                (LINK, EMAIL.into())
            ]),
            Call::Prune(vec![(LINK, "old@example.com".into())]),
            Call::Send(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: EMAIL.into()
            }),
            Call::Send(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: EMAIL.into()
            })
        ]
    );
}

#[tokio::test]
async fn failed_count_write_does_not_prevent_completion_or_full_page_continuation() {
    for count in [1, 200] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.fault = Some(("count", 1));
            s.page = (1..=count).map(|id| candidate(id, EMAIL)).collect();
        }
        super::super::list_candidates::list_candidates(&service, JOB, 0)
            .await
            .unwrap();
        let expected = if count == 200 {
            Call::Send(CrmCleanupOperation::ListCandidates {
                job_id: JOB,
                last_id: 200,
            })
        } else {
            Call::Status(JOB, CrmCleanupJobStatus::Complete)
        };
        assert_eq!(fake.calls().last(), Some(&expected));
        assert!(fake.calls().contains(&Call::Count(JOB, count)));
        assert_eq!(
            fake.calls()
                .iter()
                .filter(|x| matches!(x, Call::Job(_)))
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn each_lister_failure_keeps_its_original_context_and_class() {
    for (name, context, reason) in [
        (
            "job",
            "Failed to fetch crm cleanup job",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "page",
            "Failed to list crm cleanup candidates",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "pairs",
            "Failed to filter crm cleanup candidates by contact sources",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "prune",
            "Failed to prune crm cleanup candidates",
            FailureReason::DatabaseQueryFailed,
        ),
        (
            "send",
            "Failed to re-enqueue ListCandidates message",
            FailureReason::SqsEnqueueFailed,
        ),
        (
            "status",
            "Failed to mark crm cleanup job complete",
            FailureReason::DatabaseQueryFailed,
        ),
    ] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            s.fault = Some((name, 1));
            s.sources.clear();
            if name == "send" {
                s.page = (1..=200).map(|id| candidate(id, EMAIL)).collect();
            }
        }
        let detail = retryable(
            super::super::list_candidates::list_candidates(&service, JOB, 0).await,
            reason,
            context,
        );
        assert!(format!("{:#}", detail.source).contains(name));
    }
}

#[tokio::test]
async fn missing_job_retains_the_original_nonretryable_error() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().job = None;
    let Err(ProcessingError::NonRetryable(detail)) =
        super::super::list_candidates::list_candidates(&service, JOB, 0).await
    else {
        panic!("missing job must be terminal")
    };
    assert_eq!(detail.reason, FailureReason::InvalidData);
    assert_eq!(
        detail.source.to_string(),
        format!("Crm cleanup job not found: {JOB}")
    );
    assert_eq!(fake.calls(), [Call::Job(JOB)]);
}
