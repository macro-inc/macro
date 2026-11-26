use super::super::{
    FinalizeInvocation, HOLDER, InvocationId, OTHER_TEAM, Provider, ProviderOutcome, TEAM,
    TrackedInvocation, TrustedTokenUsage, UnresolvedReason, UsageTracking, WriteDisposition,
    make_lease,
};
use super::*;

const OWNER: Viewer = Viewer::Human {
    owned_team: Some(TEAM),
};

fn moment(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, 0, 0)
        .single()
        .expect("valid fixture instant")
}

fn attempt(job: &JobKey, id: u128, time: DateTime<Utc>) -> TrackedInvocation {
    TrackedInvocation {
        run_id: run_id(job),
        invocation_id: InvocationId::try_from(Uuid::from_u128(id)).expect("fixture attempt id"),
        user: job.scope.user_id.clone(),
        feature: AiFeature::AgentSession,
        entity: Some(job.id),
        model: Provider::OpenAi.model(),
        occurred_at: time,
    }
}

async fn observe(
    journal: &Journal,
    attempt: TrackedInvocation,
    evidence: Option<(ProviderOutcome, UsageEvidence)>,
) {
    let id = attempt.invocation_id;
    assert!(matches!(
        journal.begin(attempt.clone()).await,
        Ok(WriteDisposition::Inserted)
    ));
    assert!(matches!(
        journal.begin(attempt).await,
        Ok(WriteDisposition::Replayed)
    ));
    if let Some((outcome, usage)) = evidence {
        let finalization = FinalizeInvocation {
            invocation_id: id,
            occurred_at: moment(3, 0),
            provider_request_id: None,
            outcome,
            usage,
        };
        assert!(matches!(
            journal.finalize(finalization.clone()).await,
            Ok(WriteDisposition::Inserted)
        ));
        assert!(matches!(
            journal.finalize(finalization).await,
            Ok(WriteDisposition::Replayed)
        ));
    }
}

#[test]
fn denies_before_reading_and_distinguishes_unavailable_from_empty() {
    let day = moment(1, 0).date_naive();
    for viewer in [
        Viewer::Human { owned_team: None },
        Viewer::Human {
            owned_team: Some(OTHER_TEAM),
        },
        Viewer::Program,
    ] {
        assert_eq!(
            read_day(viewer, TEAM, day, chrono_tz::UTC, |_| {
                panic!("denied viewer must not read observations")
            }),
            Err(ReadError::Denied)
        );
    }

    assert_eq!(
        read_day(OWNER, TEAM, day, chrono_tz::UTC, |_| None),
        Err(ReadError::Unavailable)
    );
    let empty = Journal::default();
    assert_eq!(
        read_day(OWNER, TEAM, day, chrono_tz::UTC, |team| {
            assert_eq!(team, TEAM);
            Some((&[], &empty))
        }),
        Ok(Report::default())
    );
}

#[tokio::test]
async fn reconciles_exact_attribution_and_half_open_days_after_late_finalization() {
    let first = make_lease(HOLDER, 1).job().key.clone();
    let mut second = first.clone();
    second.scope.user_id =
        MacroUserIdStr::try_from_email("second-agent@example.com").expect("fixture agent");
    let mut foreign = first.clone();
    foreign.scope.team_id = OTHER_TEAM;
    let journal = Journal::default();
    let reported = UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(1, 2, 3, 4, 5));
    let failed = Some((ProviderOutcome::Failed, reported));
    let measured_zero = Some((
        ProviderOutcome::Succeeded,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
    ));

    observe(
        &journal,
        attempt(&first, 10, moment(1, 6)),
        Some((
            ProviderOutcome::Succeeded,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(1, 0, 0, 0, 0)),
        )),
    )
    .await;
    observe(&journal, attempt(&first, 11, moment(1, 7)), failed).await;
    observe(&journal, attempt(&first, 12, moment(2, 7)), failed).await;
    observe(&journal, attempt(&first, 13, moment(2, 8)), failed).await;
    observe(&journal, attempt(&second, 14, moment(1, 7)), measured_zero).await;
    observe(&journal, attempt(&foreign, 15, moment(1, 7)), failed).await;

    let mut forged = attempt(&first, 16, moment(1, 7));
    forged.user = second.scope.user_id.clone();
    observe(&journal, forged, failed).await;
    let mut mismatched_job = attempt(&first, 17, moment(1, 7));
    mismatched_job.entity = Some(Uuid::from_u128(99));
    observe(&journal, mismatched_job, failed).await;

    let jobs = [first.clone(), second.clone(), foreign];
    let day = moment(1, 0).date_naive();
    let la = read_day(OWNER, TEAM, day, chrono_tz::America::Los_Angeles, |_| {
        Some((&jobs, &journal))
    })
    .expect("current owner can read");
    assert_eq!(la.team.reported_tokens, Some(30));
    assert_eq!(la.agents.len(), 2);
    assert_eq!(la.agents[&first.scope.user_id].reported_tokens, Some(30));
    assert_eq!(la.agents[&second.scope.user_id].reported_tokens, Some(0));

    let utc = read_day(OWNER, TEAM, day, chrono_tz::UTC, |_| {
        Some((&jobs, &journal))
    })
    .expect("UTC window is valid");
    assert_eq!(utc.team.reported_tokens, Some(16));
    let next = read_day(
        OWNER,
        TEAM,
        moment(2, 0).date_naive(),
        chrono_tz::America::Los_Angeles,
        |_| Some((&jobs, &journal)),
    )
    .expect("next civil day is valid");
    assert_eq!(next.team.reported_tokens, Some(15));
    assert_eq!(next.agents.len(), 1);
}

#[tokio::test]
async fn preserves_pending_and_missing_attempts_alongside_a_known_subtotal() {
    let key = make_lease(HOLDER, 1).job().key.clone();
    let journal = Journal::default();
    let time = moment(1, 9);
    let day = time.date_naive();
    let jobs = [key.clone()];
    observe(&journal, attempt(&key, 20, time), None).await;
    let read = || {
        read_day(OWNER, TEAM, day, chrono_tz::UTC, |_| {
            Some((&jobs, &journal))
        })
    };
    assert_eq!(
        read().expect("pending observation can be read").team,
        Coverage {
            reported_tokens: None,
            pending: 1,
            missing: 0,
        }
    );

    observe(
        &journal,
        attempt(&key, 21, time),
        Some((
            ProviderOutcome::Unknown,
            UsageEvidence::Missing(UnresolvedReason::Interrupted),
        )),
    )
    .await;
    assert_eq!(
        read().expect("missing observation can be read").team,
        Coverage {
            reported_tokens: None,
            pending: 1,
            missing: 1,
        }
    );

    observe(
        &journal,
        attempt(&key, 22, time),
        Some((
            ProviderOutcome::Cancelled,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 3, 0, 0, 0)),
        )),
    )
    .await;
    let report = read().expect("partial observation can be read");
    assert_eq!(
        report.team,
        Coverage {
            reported_tokens: Some(3),
            pending: 1,
            missing: 1,
        }
    );
    assert_eq!(report.agents[&key.scope.user_id], report.team);
}

#[tokio::test]
async fn refuses_finalization_for_a_different_invocation() {
    let key = make_lease(HOLDER, 1).job().key.clone();
    let journal = Journal::default();
    let time = moment(1, 9);
    let begin = attempt(&key, 30, time);
    let id = begin.invocation_id;
    observe(&journal, begin, None).await;

    journal.finals.lock().expect("observation finals").insert(
        id,
        FinalizeInvocation {
            invocation_id: attempt(&key, 31, time).invocation_id,
            occurred_at: time,
            provider_request_id: None,
            outcome: ProviderOutcome::Succeeded,
            usage: UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
        },
    );

    let jobs = [key];
    assert_eq!(
        read_day(OWNER, TEAM, time.date_naive(), chrono_tz::UTC, |_| {
            Some((&jobs, &journal))
        }),
        Err(ReadError::InconsistentJournal)
    );
}
