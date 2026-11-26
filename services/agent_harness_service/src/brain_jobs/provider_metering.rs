//! Private in-process rehearsal of the parent fence and observational metering.

use std::{collections::HashMap, sync::Mutex};

use ai_usage::financial::{
    FinalizeInvocation, FinancialError, InvocationId, ProviderModel, ProviderOutcome, RunId,
    UnresolvedReason, UsageEvidence, WriteDisposition,
};
use ai_usage::{AiFeature, TrackedInvocation, UsageTracking};
use axum::body::Bytes;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use futures::{Stream, StreamExt};
use uuid::Uuid;

use super::{JobKey, Lease};
use crate::anthropic_gateway::{
    brain::{BrainAccess, BrainCaller, BrainRefusal},
    usage::SseUsage as ClaudeUsage,
};
use crate::fireworks_gateway::usage::SseUsage as OpenAiUsage;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    Claude,
    OpenAi,
    Gemini,
}

impl Provider {
    fn model(self) -> ProviderModel {
        let (provider, model) = match self {
            Self::Claude => ("synthetic-claude", "fixture-claude"),
            Self::OpenAi => ("synthetic-openai", "fixture-openai"),
            Self::Gemini => ("synthetic-gemini", "fixture-gemini"),
        };
        ProviderModel::new(provider, model).expect("valid fixture model identifiers")
    }
}

#[derive(Debug, Clone, Copy)]
struct Request {
    id: InvocationId,
    provider: Provider,
}

enum Response<S> {
    Stream(S),
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Dispatch {
    Ready,
    Unknown,
    Finished(FinalizeInvocation),
}

#[derive(Debug, PartialEq, Eq)]
enum Refusal {
    Access(BrainRefusal),
    Scope,
    Lease,
    Attempt,
    ChangedRequest,
}

#[derive(Debug, PartialEq, Eq)]
enum Observation {
    Stored(WriteDisposition),
    Conflict,
    Unavailable,
}

impl From<Result<WriteDisposition, FinancialError>> for Observation {
    fn from(result: Result<WriteDisposition, FinancialError>) -> Self {
        match result {
            Ok(disposition) => Self::Stored(disposition),
            Err(FinancialError::ReplayConflict { .. }) => Self::Conflict,
            Err(_) => Self::Unavailable,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Delivery {
    dispatch: Dispatch,
    begin: Option<Observation>,
    finalize: Option<Observation>,
}

struct Attempt {
    provider: Provider,
    tracked: TrackedInvocation,
    dispatch: Dispatch,
}

struct Parent {
    state: Mutex<State>,
}

struct State {
    job: JobKey,
    deadline: DateTime<Utc>,
    fence: Option<(Uuid, i64)>,
    attempts: HashMap<InvocationId, Attempt>,
    latest: Option<InvocationId>,
}

enum Claim {
    Send(TrackedInvocation),
    Unknown,
    Observe(TrackedInvocation, FinalizeInvocation),
}

impl Parent {
    fn new(lease: &Lease) -> Self {
        Self {
            state: Mutex::new(State {
                job: lease.job().key.clone(),
                deadline: lease.job().deadline,
                fence: Some((lease.holder(), lease.epoch())),
                attempts: HashMap::new(),
                latest: None,
            }),
        }
    }

    /// Only the trusted parent issues attempts. A new attempt after a rejection
    /// needs a new authorization and keeps all earlier attempt history intact.
    fn issue(&self, lease: &Lease, provider: Provider) -> Result<Request, Refusal> {
        let mut state = self.state.lock().expect("parent fence");
        state.check_lease(lease)?;

        if let Some(id) = state.latest
            && !matches!(
                state.attempts[&id].dispatch,
                Dispatch::Finished(FinalizeInvocation {
                    outcome: ProviderOutcome::Failed,
                    ..
                })
            )
        {
            return Err(Refusal::Attempt);
        }

        let key = &state.job;
        let id = InvocationId::new();
        let tracked = TrackedInvocation {
            run_id: run_id(key),
            invocation_id: id,
            user: key.scope.user_id.clone(),
            feature: AiFeature::AgentSession,
            entity: Some(key.id),
            model: provider.model(),
            occurred_at: Utc::now(),
        };
        state.attempts.insert(
            id,
            Attempt {
                provider,
                tracked,
                dispatch: Dispatch::Ready,
            },
        );
        state.latest = Some(id);
        Ok(Request { id, provider })
    }

    fn claim(
        &self,
        caller: &BrainCaller,
        lease: &Lease,
        request: Request,
    ) -> Result<Claim, Refusal> {
        let mut state = self.state.lock().expect("parent fence");
        state.check_owner(caller)?;
        state.check_lease(lease)?;

        let attempt = state
            .attempts
            .get_mut(&request.id)
            .ok_or(Refusal::Attempt)?;
        if attempt.provider != request.provider {
            return Err(Refusal::ChangedRequest);
        }

        Ok(match &attempt.dispatch {
            Dispatch::Ready => {
                attempt.dispatch = Dispatch::Unknown;
                Claim::Send(attempt.tracked.clone())
            }
            Dispatch::Unknown => Claim::Unknown,
            Dispatch::Finished(evidence) => {
                Claim::Observe(attempt.tracked.clone(), evidence.clone())
            }
        })
    }

    fn check_lease(&self, lease: &Lease) -> Result<(), Refusal> {
        self.state.lock().expect("parent fence").check_lease(lease)
    }

    fn finish(&self, evidence: &FinalizeInvocation) {
        let mut state = self.state.lock().expect("parent fence");
        let attempt = state
            .attempts
            .get_mut(&evidence.invocation_id)
            .expect("claimed attempt");
        attempt.dispatch = Dispatch::Finished(evidence.clone());
    }

    fn history(&self, caller: &BrainCaller, id: InvocationId) -> Result<Option<Dispatch>, Refusal> {
        let state = self.state.lock().expect("parent fence");
        state.check_owner(caller)?;
        Ok(state
            .attempts
            .get(&id)
            .map(|attempt| attempt.dispatch.clone()))
    }
}

impl State {
    fn check_owner(&self, caller: &BrainCaller) -> Result<(), Refusal> {
        let scope = &self.job.scope;
        if caller.user_id != scope.user_id || caller.team_id != scope.team_id {
            return Err(Refusal::Scope);
        }
        Ok(())
    }

    fn check_lease(&self, lease: &Lease) -> Result<(), Refusal> {
        if lease.job().key != self.job {
            return Err(Refusal::Scope);
        }
        if self.fence != Some((lease.holder(), lease.epoch())) || Utc::now() >= self.deadline {
            return Err(Refusal::Lease);
        }
        Ok(())
    }
}

fn run_id(key: &JobKey) -> RunId {
    let mut name = b"brain-provider-run:".to_vec();
    name.extend_from_slice(key.id.as_bytes());
    name.extend_from_slice(key.scope.user_id.as_ref().as_bytes());
    RunId::try_from(Uuid::new_v5(&key.scope.team_id, &name)).expect("UUIDv5 is non-nil")
}

struct Handler<'a> {
    access: &'a BrainAccess,
    parent: &'a Parent,
    tracking: &'a dyn UsageTracking,
}

impl Handler<'_> {
    async fn handle<S>(
        &self,
        headers: &HeaderMap,
        lease: &Lease,
        request: Request,
        send: impl FnOnce(Provider) -> Response<S>,
    ) -> Result<Delivery, Refusal>
    where
        S: Stream<Item = Result<Bytes, ()>>,
    {
        let caller = self
            .access
            .authenticate_enabled(headers)
            .await
            .map_err(Refusal::Access)?;
        let (tracked, evidence) = match self.parent.claim(&caller, lease, request)? {
            Claim::Unknown => {
                return Ok(Delivery {
                    dispatch: Dispatch::Unknown,
                    begin: None,
                    finalize: None,
                });
            }
            Claim::Send(tracked) => (tracked, None),
            Claim::Observe(tracked, evidence) => (tracked, Some(evidence)),
        };
        let begin = Observation::from(self.tracking.begin(tracked).await);

        let evidence = match evidence {
            Some(evidence) if begin != Observation::Conflict => evidence,
            None if matches!(
                begin,
                Observation::Stored(WriteDisposition::Inserted) | Observation::Unavailable
            ) =>
            {
                // No await or fence lock between the current-lease check and
                // the fake send. A real downstream writer still needs its own fence.
                self.parent.check_lease(lease)?;
                let evidence = observe(request, send(request.provider)).await;
                // Evidence belongs to the original dispatch, even after takeover.
                self.parent.finish(&evidence);
                evidence
            }
            evidence => {
                // A pre-existing begin cannot authorize a send. The original
                // delivery may already have reached the provider.
                return Ok(Delivery {
                    dispatch: evidence.map_or(Dispatch::Unknown, Dispatch::Finished),
                    begin: Some(begin),
                    finalize: None,
                });
            }
        };
        let finalize = Observation::from(self.tracking.finalize(evidence.clone()).await);

        Ok(Delivery {
            dispatch: Dispatch::Finished(evidence),
            begin: Some(begin),
            finalize: Some(finalize),
        })
    }

    async fn history(
        &self,
        headers: &HeaderMap,
        id: InvocationId,
    ) -> Result<Option<Dispatch>, Refusal> {
        let caller = self
            .access
            .authenticate_enabled(headers)
            .await
            .map_err(Refusal::Access)?;
        self.parent.history(&caller, id)
    }
}

async fn observe(
    request: Request,
    response: Response<impl Stream<Item = Result<Bytes, ()>>>,
) -> FinalizeInvocation {
    let (outcome, usage) = match response {
        Response::Stream(stream) => observe_stream(request.provider, stream).await,
        Response::Rejected => (
            ProviderOutcome::Failed,
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported),
        ),
    };
    FinalizeInvocation {
        invocation_id: request.id,
        occurred_at: Utc::now(),
        provider_request_id: None,
        outcome,
        usage,
    }
}

async fn observe_stream(
    provider: Provider,
    stream: impl Stream<Item = Result<Bytes, ()>>,
) -> (ProviderOutcome, UsageEvidence) {
    let mut stream = std::pin::pin!(stream);
    let mut claude = ClaudeUsage::default();
    let mut openai = OpenAiUsage::default();

    while let Some(Ok(chunk)) = stream.next().await {
        let evidence = match provider {
            Provider::Claude => {
                claude.observe(&chunk);
                claude.evidence()
            }
            Provider::OpenAi | Provider::Gemini => {
                // The synthetic Gemini fixture shares the terminal marker only.
                openai.observe(&chunk);
                openai.evidence()
            }
        };
        if let Some(evidence) = evidence {
            let evidence = if provider == Provider::Gemini {
                UsageEvidence::Missing(UnresolvedReason::UnsupportedDimensions)
            } else {
                evidence
            };
            return (ProviderOutcome::Succeeded, evidence);
        }
    }

    (
        ProviderOutcome::Unknown,
        UsageEvidence::Missing(UnresolvedReason::Interrupted),
    )
}
