use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use ai_billing::{AdmissionFuture, AiAdmissionService};
use ai_usage::{
    FinancialFuture,
    financial::{ReplayPhase, TrustedTokenUsage},
};
use axum::http::{HeaderValue, header::AUTHORIZATION};
use chrono::{Duration, NaiveDate};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use futures::{future::pending, stream};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Notify;

use super::*;
use crate::{
    anthropic_gateway::brain::{BrainAuthenticator, BrainLookup, BrainRollout},
    brain_jobs::{Job, JobScope, PromptPins, TaskTimeIntent},
};

const TEAM: Uuid = Uuid::from_u128(1);
const JOB: Uuid = Uuid::from_u128(2);
const HOLDER: Uuid = Uuid::from_u128(3);
const OTHER_TEAM: Uuid = Uuid::from_u128(4);
const CLAUDE_ZERO: &str = concat!(
    "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\n",
    "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":0}}\n\n",
    "event: message_stop\ndata: {}\n\n",
);
const OPENAI_COMPLETE: &str = concat!(
    "data: {\"choices\":[{\"delta\":{\"content\":\"synthetic output\"}}]}\n\n",
    "data: {\"usage\":{\"prompt_tokens\":25,\"completion_tokens\":5,",
    "\"prompt_tokens_details\":{\"cached_tokens\":9}}}\n\n",
    "data: [DONE]\n\n",
);

struct FakeBrains;

impl BrainAuthenticator for FakeBrains {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            let (email, team_id) = match key {
                "fixture-owner" => ("owner@example.com", TEAM),
                "fixture-other-team" => ("owner@example.com", OTHER_TEAM),
                "fixture-other-owner" => ("other@example.com", TEAM),
                _ => return Ok(None),
            };
            Ok(Some(BrainCaller {
                user_id: MacroUserIdStr::try_from_email(email).unwrap(),
                team_id,
            }))
        })
    }
}

struct UnexpectedAdmission;

impl AiAdmissionService for UnexpectedAdmission {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, _: AiFeature) -> AdmissionFuture<'a> {
        panic!("mock observations must not invoke admission")
    }
}

fn access(on: bool) -> BrainAccess {
    let creator = MacroUserIdStr::try_from_email("creator@example.com").unwrap();
    let mut creators = agent_credentials::FakeAgentCreators::default();
    for email in ["owner@example.com", "other@example.com"] {
        creators.set(
            MacroUserIdStr::try_from_email(email).unwrap(),
            creator.clone(),
        );
    }

    let mut flags = FakeFeatureFlags::default();
    flags.set(
        creator,
        Ok(FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.into(),
            FlagValue::Boolean(on),
        )])),
    );

    BrainAccess {
        brains: Arc::new(FakeBrains),
        rollout: BrainRollout::new(creators, flags),
        admission: Arc::new(UnexpectedAdmission),
    }
}

fn make_lease(holder: Uuid, epoch: i64) -> Lease {
    Lease {
        job: Job {
            key: JobKey {
                id: JOB,
                scope: JobScope {
                    team_id: TEAM,
                    user_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
                },
            },
            intent: TaskTimeIntent {
                action_id: Uuid::from_u128(5),
                task_id: "fixture-task".to_owned(),
                date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                minutes: 10,
            },
            pins: PromptPins {
                repo_head_sha: "a".repeat(40),
                charter_sha256: "b".repeat(64),
                task_pack_id: "fixture-pack".to_owned(),
                task_pack_revision: "fixture-rev".to_owned(),
            },
            deadline: Utc::now() + Duration::minutes(5),
        },
        holder,
        epoch,
    }
}

fn headers(value: &'static str) -> HeaderMap {
    HeaderMap::from_iter([(AUTHORIZATION, HeaderValue::from_static(value))])
}

#[derive(Default)]
struct Journal {
    begins: Mutex<HashMap<InvocationId, TrackedInvocation>>,
    finals: Mutex<HashMap<InvocationId, FinalizeInvocation>>,
    begin_unavailable: AtomicBool,
    lose_finalize_ack: AtomicBool,
    begin_gate: Option<(Notify, Notify)>,
}

impl UsageTracking for Journal {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            if let Some((entered, release)) = &self.begin_gate {
                entered.notify_one();
                release.notified().await;
            }
            if self.begin_unavailable.load(Ordering::Relaxed) {
                return Err(FinancialError::CapabilityUnavailable);
            }
            let id = request.invocation_id;
            write(
                &mut self.begins.lock().unwrap(),
                id,
                ReplayPhase::Begin,
                request,
            )
        })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            let id = evidence.invocation_id;
            if !self.begins.lock().unwrap().contains_key(&id) {
                return Err(FinancialError::CapabilityUnavailable);
            }
            let result = write(
                &mut self.finals.lock().unwrap(),
                id,
                ReplayPhase::Finalize,
                evidence,
            );
            if self.lose_finalize_ack.swap(false, Ordering::Relaxed) && result.is_ok() {
                return Err(FinancialError::CapabilityUnavailable);
            }
            result
        })
    }
}

fn write<T: Eq>(
    rows: &mut HashMap<InvocationId, T>,
    invocation_id: InvocationId,
    phase: ReplayPhase,
    value: T,
) -> Result<WriteDisposition, FinancialError> {
    use std::collections::hash_map::Entry;
    match rows.entry(invocation_id) {
        Entry::Vacant(entry) => {
            entry.insert(value);
            Ok(WriteDisposition::Inserted)
        }
        Entry::Occupied(entry) if *entry.get() == value => Ok(WriteDisposition::Replayed),
        Entry::Occupied(_) => Err(FinancialError::ReplayConflict {
            invocation_id,
            phase,
        }),
    }
}

fn split_events(events: &'static str) -> impl Stream<Item = Result<Bytes, ()>> {
    stream::iter(
        events
            .as_bytes()
            .chunks(7)
            .map(|part| Ok(Bytes::from_static(part))),
    )
}

fn unexpected_send(_: Provider) -> Response<stream::Empty<Result<Bytes, ()>>> {
    panic!("previously claimed or unauthorized requests must never send")
}

#[tokio::test]
async fn identity_lease_and_frozen_request_are_checked_before_any_observation() {
    let parent = Parent::new(&make_lease(HOLDER, 2));
    let lease = make_lease(HOLDER, 2);
    let request = parent.issue(&lease, Provider::Claude).unwrap();
    let journal = Journal::default();
    let handler = Handler {
        access: &access(true),
        parent: &parent,
        tracking: &journal,
    };
    let owner = headers("Bearer fixture-owner");

    for (headers, refusal) in [
        (
            HeaderMap::new(),
            Refusal::Access(BrainRefusal::Unauthenticated),
        ),
        (
            headers("Bearer unknown"),
            Refusal::Access(BrainRefusal::Unauthenticated),
        ),
        (headers("Bearer fixture-other-team"), Refusal::Scope),
        (headers("Bearer fixture-other-owner"), Refusal::Scope),
    ] {
        assert_eq!(
            handler
                .handle(&headers, &lease, request, unexpected_send)
                .await,
            Err(refusal)
        );
    }
    let disabled = Handler {
        access: &access(false),
        ..handler
    };
    assert_eq!(
        disabled
            .handle(&owner, &lease, request, unexpected_send)
            .await,
        Err(Refusal::Access(BrainRefusal::Forbidden))
    );

    for stale in [make_lease(HOLDER, 1), make_lease(OTHER_TEAM, 2)] {
        assert_eq!(
            handler
                .handle(&owner, &stale, request, unexpected_send)
                .await,
            Err(Refusal::Lease)
        );
    }
    assert_eq!(
        handler
            .handle(
                &owner,
                &lease,
                Request {
                    provider: Provider::Gemini,
                    ..request
                },
                unexpected_send
            )
            .await,
        Err(Refusal::ChangedRequest)
    );
    assert_eq!(
        handler
            .handle(
                &owner,
                &lease,
                Request {
                    id: InvocationId::new(),
                    ..request
                },
                unexpected_send
            )
            .await,
        Err(Refusal::Attempt)
    );
    assert!(journal.begins.lock().unwrap().is_empty());
    assert!(journal.finals.lock().unwrap().is_empty());

    let mut foreign_job = lease.job().key.clone();
    foreign_job.scope.team_id = OTHER_TEAM;
    assert_ne!(run_id(&foreign_job), run_id(&lease.job().key));
    foreign_job = lease.job().key.clone();
    foreign_job.scope.user_id = MacroUserIdStr::try_from_email("other@example.com").unwrap();
    assert_ne!(run_id(&foreign_job), run_id(&lease.job().key));
}

#[tokio::test]
async fn split_stream_retry_and_scoped_history_keep_immutable_attribution() {
    let parent = Parent::new(&make_lease(HOLDER, 1));
    let lease = make_lease(HOLDER, 1);
    let first = parent.issue(&lease, Provider::OpenAi).unwrap();
    let journal = Journal::default();
    let handler = Handler {
        access: &access(true),
        parent: &parent,
        tracking: &journal,
    };
    let owner = headers("Bearer fixture-owner");

    let rejected = handler
        .handle(&owner, &lease, first, |provider| {
            assert_eq!(provider, Provider::OpenAi);
            assert!(
                parent.state.try_lock().is_ok(),
                "release parent fence before dispatch"
            );
            assert!(journal.begins.lock().unwrap().contains_key(&first.id));
            Response::<stream::Empty<Result<Bytes, ()>>>::Rejected
        })
        .await
        .unwrap();
    assert!(matches!(
        rejected.dispatch,
        Dispatch::Finished(FinalizeInvocation {
            outcome: ProviderOutcome::Failed,
            ..
        })
    ));

    let retry = parent.issue(&lease, Provider::OpenAi).unwrap();
    assert_ne!(retry.id, first.id);
    let completed = handler
        .handle(&owner, &lease, retry, |provider| {
            assert_eq!(provider, Provider::OpenAi);
            Response::Stream(split_events(OPENAI_COMPLETE))
        })
        .await
        .unwrap();
    let Dispatch::Finished(evidence) = &completed.dispatch else {
        panic!("expected terminal evidence");
    };
    assert_eq!(
        evidence.usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(16, 5, 9, 0, 0))
    );
    assert_eq!(
        completed.finalize,
        Some(Observation::Stored(WriteDisposition::Inserted))
    );
    assert_eq!(
        journal.finals.lock().unwrap().get(&retry.id),
        Some(evidence)
    );
    assert_eq!(evidence.provider_request_id, None);

    let replay = handler
        .handle(&owner, &lease, retry, unexpected_send)
        .await
        .unwrap();
    assert_eq!(replay.dispatch, completed.dispatch);
    assert_eq!(
        replay.begin,
        Some(Observation::Stored(WriteDisposition::Replayed))
    );
    assert_eq!(
        replay.finalize,
        Some(Observation::Stored(WriteDisposition::Replayed))
    );
    assert_eq!(
        handler
            .handle(
                &owner,
                &lease,
                Request {
                    provider: Provider::Claude,
                    ..retry
                },
                unexpected_send
            )
            .await,
        Err(Refusal::ChangedRequest)
    );
    assert_eq!(
        handler
            .history(&headers("Bearer fixture-other-team"), first.id)
            .await,
        Err(Refusal::Scope)
    );
    assert_eq!(
        handler
            .history(&headers("Bearer fixture-other-owner"), first.id)
            .await,
        Err(Refusal::Scope)
    );
    parent.state.lock().unwrap().fence = None;
    assert_eq!(
        handler.handle(&owner, &lease, retry, unexpected_send).await,
        Err(Refusal::Lease)
    );
    assert_eq!(
        handler.history(&owner, first.id).await,
        Ok(Some(rejected.dispatch))
    );
    assert_eq!(
        handler.history(&owner, retry.id).await,
        Ok(Some(completed.dispatch))
    );
    assert!(matches!(
        parent.issue(&lease, Provider::Gemini),
        Err(Refusal::Lease)
    ));

    let writes = journal.begins.lock().unwrap();
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[&first.id].run_id, writes[&retry.id].run_id);
    assert_eq!(writes[&retry.id].run_id, run_id(&lease.job().key));
    assert_eq!(writes[&retry.id].user, lease.job().key.scope.user_id);
    assert_eq!(writes[&retry.id].entity, Some(JOB));
    assert_eq!(writes[&retry.id].model, Provider::OpenAi.model());
}

#[tokio::test]
async fn usage_distinguishes_zero_absent_interrupted_and_unsupported() {
    for (provider, frames, outcome, expected) in [
        (
            Provider::Claude,
            CLAUDE_ZERO,
            ProviderOutcome::Succeeded,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
        ),
        (
            Provider::OpenAi,
            "data: {\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0}}\n\ndata: [DONE]\n\n",
            ProviderOutcome::Succeeded,
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(0, 0, 0, 0, 0)),
        ),
        (
            Provider::OpenAi,
            "data: {\"usage\":{\"prompt_tokens\":0}}\n\ndata: [DONE]\n\n",
            ProviderOutcome::Succeeded,
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported),
        ),
        (
            Provider::Claude,
            "event: message_stop\ndata: {}\n\n",
            ProviderOutcome::Succeeded,
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported),
        ),
        (
            Provider::Claude,
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n",
            ProviderOutcome::Unknown,
            UsageEvidence::Missing(UnresolvedReason::Interrupted),
        ),
        (
            Provider::Gemini,
            "data: [DONE]\n\n",
            ProviderOutcome::Succeeded,
            UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions),
        ),
    ] {
        let parent = Parent::new(&make_lease(HOLDER, 1));
        let lease = make_lease(HOLDER, 1);
        let request = parent.issue(&lease, provider).unwrap();
        let journal = Journal::default();
        let handler = Handler {
            access: &access(true),
            parent: &parent,
            tracking: &journal,
        };
        let owner = headers("Bearer fixture-owner");
        let delivery = handler
            .handle(&owner, &lease, request, |_| {
                Response::Stream(split_events(frames))
            })
            .await
            .unwrap();
        let Dispatch::Finished(evidence) = delivery.dispatch else {
            panic!("expected an observation for the stream");
        };
        assert_eq!(evidence.outcome, outcome);
        assert_eq!(evidence.usage, expected);
        assert_eq!(
            journal.finals.lock().unwrap().get(&request.id),
            Some(&evidence)
        );
        assert!(matches!(
            parent.issue(&lease, provider),
            Err(Refusal::Attempt)
        ));
    }
}

#[tokio::test]
async fn evidence_is_frozen_at_the_first_terminal_frame() {
    for (provider, terminal, trailing) in [
        (
            Provider::Claude,
            "event: message_stop\ndata: {}\n\n",
            CLAUDE_ZERO,
        ),
        (Provider::OpenAi, "data: [DONE]\n\n", OPENAI_COMPLETE),
    ] {
        for chunks in [
            vec![Bytes::from(format!("{terminal}{trailing}"))],
            vec![
                Bytes::from_static(terminal.as_bytes()),
                Bytes::from_static(trailing.as_bytes()),
            ],
        ] {
            let observed = observe_stream(provider, stream::iter(chunks.into_iter().map(Ok))).await;
            assert_eq!(
                observed,
                (
                    ProviderOutcome::Succeeded,
                    UsageEvidence::Missing(UnresolvedReason::UsageNotReported)
                )
            );
        }
    }

    let inconsistent = concat!(
        "data: {\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0,",
        "\"prompt_tokens_details\":{\"cached_tokens\":1}}}\n\n",
        "data: [DONE]\n\n",
    );
    assert_eq!(
        observe_stream(Provider::OpenAi, split_events(inconsistent)).await,
        (
            ProviderOutcome::Succeeded,
            UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
        )
    );
}

#[tokio::test]
async fn begin_outage_and_lost_finalize_ack_recover_via_observation_only() {
    let parent = Parent::new(&make_lease(HOLDER, 1));
    let lease = make_lease(HOLDER, 1);
    let request = parent.issue(&lease, Provider::Claude).unwrap();
    let journal = Journal {
        begin_unavailable: AtomicBool::new(true),
        lose_finalize_ack: AtomicBool::new(true),
        ..Journal::default()
    };
    let handler = Handler {
        access: &access(true),
        parent: &parent,
        tracking: &journal,
    };
    let owner = headers("Bearer fixture-owner");

    let completed = handler
        .handle(&owner, &lease, request, |_| {
            Response::Stream(split_events(CLAUDE_ZERO))
        })
        .await
        .unwrap();
    assert!(matches!(completed.dispatch, Dispatch::Finished(_)));
    assert_eq!(completed.begin, Some(Observation::Unavailable));
    assert_eq!(completed.finalize, Some(Observation::Unavailable));

    journal.begin_unavailable.store(false, Ordering::Relaxed);
    let lost_ack = handler
        .handle(&owner, &lease, request, unexpected_send)
        .await
        .unwrap();
    assert_eq!(lost_ack.dispatch, completed.dispatch);
    assert_eq!(
        lost_ack.begin,
        Some(Observation::Stored(WriteDisposition::Inserted))
    );
    assert_eq!(lost_ack.finalize, Some(Observation::Unavailable));

    let recovered = handler
        .handle(&owner, &lease, request, unexpected_send)
        .await
        .unwrap();
    assert_eq!(recovered.dispatch, completed.dispatch);
    assert_eq!(
        recovered.begin,
        Some(Observation::Stored(WriteDisposition::Replayed))
    );
    assert_eq!(
        recovered.finalize,
        Some(Observation::Stored(WriteDisposition::Replayed))
    );
}

#[tokio::test]
async fn concurrent_duplicate_and_cancelled_stream_remain_unknown_across_takeover() {
    let parent = Parent::new(&make_lease(HOLDER, 1));
    let original = make_lease(HOLDER, 1);
    let request = parent.issue(&original, Provider::Claude).unwrap();
    let journal = Journal::default();
    let handler = Handler {
        access: &access(true),
        parent: &parent,
        tracking: &journal,
    };
    let owner = headers("Bearer fixture-owner");
    let streaming = Notify::new();

    {
        let pending_delivery = handler.handle(&owner, &original, request, |_| {
            Response::Stream(stream::once(async {
                streaming.notify_one();
                pending().await
            }))
        });
        tokio::pin!(pending_delivery);

        tokio::select! {
            _ = streaming.notified() => {}
            _ = &mut pending_delivery => panic!("the stream is still open"),
        }

        assert_eq!(
            handler
                .handle(&owner, &original, request, unexpected_send)
                .await
                .unwrap()
                .dispatch,
            Dispatch::Unknown
        );
    }

    let current = make_lease(OTHER_TEAM, 2);
    parent.state.lock().unwrap().fence = Some((OTHER_TEAM, 2));
    assert_eq!(
        handler
            .handle(&owner, &original, request, unexpected_send)
            .await,
        Err(Refusal::Lease)
    );
    assert_eq!(
        handler
            .handle(&owner, &current, request, unexpected_send)
            .await
            .unwrap()
            .dispatch,
        Dispatch::Unknown
    );
    assert_eq!(
        handler.history(&owner, request.id).await,
        Ok(Some(Dispatch::Unknown))
    );
    assert!(matches!(
        parent.issue(&current, Provider::Claude),
        Err(Refusal::Attempt)
    ));
    assert_eq!(journal.begins.lock().unwrap().len(), 1);
    assert!(journal.finals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn takeover_during_begin_fences_the_waiting_sender() {
    let parent = Parent::new(&make_lease(HOLDER, 1));
    let original = make_lease(HOLDER, 1);
    let request = parent.issue(&original, Provider::Claude).unwrap();
    let journal = Journal {
        begin_gate: Some((Notify::new(), Notify::new())),
        ..Journal::default()
    };
    let handler = Handler {
        access: &access(true),
        parent: &parent,
        tracking: &journal,
    };
    let owner = headers("Bearer fixture-owner");
    let (entered, release) = journal.begin_gate.as_ref().unwrap();

    let (result, ()) = tokio::join!(
        handler.handle(&owner, &original, request, unexpected_send),
        async {
            entered.notified().await;
            parent.state.lock().unwrap().fence = Some((OTHER_TEAM, 2));
            release.notify_one();
        },
    );

    assert_eq!(result, Err(Refusal::Lease));
    let current = make_lease(OTHER_TEAM, 2);
    assert_eq!(
        handler
            .handle(&owner, &current, request, unexpected_send)
            .await
            .unwrap()
            .dispatch,
        Dispatch::Unknown
    );
}

#[tokio::test]
async fn preexisting_tracking_begin_cannot_mint_dispatch_authority() {
    for (model, expected) in [
        (
            Provider::Claude.model(),
            Observation::Stored(WriteDisposition::Replayed),
        ),
        (Provider::Gemini.model(), Observation::Conflict),
    ] {
        let lease = make_lease(HOLDER, 1);
        let parent = Parent::new(&lease);
        let request = parent.issue(&lease, Provider::Claude).unwrap();
        let journal = Journal::default();
        let tracked = parent.state.lock().unwrap().attempts[&request.id]
            .tracked
            .clone();
        journal
            .begin(TrackedInvocation { model, ..tracked })
            .await
            .unwrap();

        let handler = Handler {
            access: &access(true),
            parent: &parent,
            tracking: &journal,
        };
        let owner = headers("Bearer fixture-owner");
        let result = handler
            .handle(&owner, &lease, request, unexpected_send)
            .await
            .unwrap();
        assert_eq!(result.begin, Some(expected));
        assert_eq!(result.dispatch, Dispatch::Unknown);
        assert!(journal.finals.lock().unwrap().is_empty());
    }
}
