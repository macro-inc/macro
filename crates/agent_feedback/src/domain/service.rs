//! The feedback service: the rollout gate, which responses can be rated by
//! whom, the context recorded with a rating, and safe-to-repeat writes.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, PoisonError};

use agent_fold::domain::log::AgentSessionId;
use cached::{Cached, TimedSizedCache};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, RequiredPermission};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use mention_utils::parse::{ParsedXmlText, TextSegment, XmlTag};
use messages::domain::api::MessageReader;
use messages::domain::models::MessageParent;
use messages::domain::ports::MessageError;
use tracing::Level;
use tracing::field::Empty;
use uuid::Uuid;

use super::model::{
    AGENT_RESPONSE_FEEDBACK_FLAG, AgentKind, AppendOutcome, ExportCursor, ExportLimit, ExportPage,
    FeedbackContainer, FeedbackError, FeedbackState, FeedbackSubject, FeedbackWrite,
    MAX_SUGGESTIONS_LISTED, MyFeedback, Note, RateRequest, RatedResponse, Rater, Rating,
    ResponseContext, RetractRequest, SubjectKind, Surface,
};
use super::ports::{
    AgentAccounts, AgentSessions, FeedbackApi, FeedbackRepo, RoutineRuns, Suggestions,
};

#[cfg(test)]
mod test;

/// How long one person's flag answer is kept, so rendering a long transcript
/// does not ask PostHog once per request.
const FLAG_KEPT_FOR_SECS: u64 = 60;
/// How many people's flag answers are kept at once.
const PEOPLE_REMEMBERED: usize = 10_000;

/// Records ratings of agent responses for people with the rollout flag.
pub struct FeedbackService<Repo, Flags, Sessions, Runs, Accounts, Suggs> {
    repo: Repo,
    flags: Option<Flags>,
    flag_kept: Mutex<TimedSizedCache<String, bool>>,
    sessions: Sessions,
    runs: Runs,
    accounts: Accounts,
    suggestions: Suggs,
    messages: Arc<dyn MessageReader>,
}

impl<Repo, Flags, Sessions, Runs, Accounts, Suggs>
    FeedbackService<Repo, Flags, Sessions, Runs, Accounts, Suggs>
where
    Repo: FeedbackRepo,
    Flags: FeatureFlags + 'static,
    Sessions: AgentSessions,
    Runs: RoutineRuns,
    Accounts: AgentAccounts,
    Suggs: Suggestions,
{
    /// Build the service. Without `flags` the feature is off for everyone.
    pub fn new(
        repo: Repo,
        flags: Option<Flags>,
        sessions: Sessions,
        runs: Runs,
        accounts: Accounts,
        suggestions: Suggs,
        messages: Arc<dyn MessageReader>,
    ) -> Self {
        Self {
            repo,
            flags,
            flag_kept: Mutex::new(TimedSizedCache::with_size_and_lifespan(
                PEOPLE_REMEMBERED,
                FLAG_KEPT_FOR_SECS,
            )),
            sessions,
            runs,
            accounts,
            suggestions,
            messages,
        }
    }

    /// Refuse, as if the routes did not exist, a person the flag leaves out.
    #[tracing::instrument(name = "agent_feedback.flag", err(level = Level::DEBUG), skip_all, fields(
        agent_feedback.flag.cached = Empty,
    ))]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<(), FeedbackError> {
        let Some(flags) = &self.flags else {
            return Err(FeedbackError::NotFound);
        };
        let kept = self
            .flag_kept
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .cache_get(user.as_ref())
            .copied();
        tracing::Span::current().record("agent_feedback.flag.cached", kept.is_some());
        let enabled = match kept {
            Some(enabled) => enabled,
            // Only an answer is kept: flags that can't be read leave the
            // feature off for this request alone.
            None => match flags.load(user).await {
                Ok(snapshot) => {
                    let enabled = snapshot.is_enabled(AGENT_RESPONSE_FEEDBACK_FLAG);
                    self.flag_kept
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .cache_set(user.as_ref().to_owned(), enabled);
                    enabled
                }
                Err(error) => {
                    tracing::warn!(
                        ?error,
                        "feature flags unavailable; agent feedback stays off"
                    );
                    false
                }
            },
        };
        if enabled {
            Ok(())
        } else {
            Err(FeedbackError::NotFound)
        }
    }

    /// Check the response is rated by a person through access to its own
    /// container, append the row, and say what it made of the person's state.
    #[expect(
        clippy::too_many_arguments,
        reason = "one write's fields, shared by rate and retract"
    )]
    async fn write(
        &self,
        response: RatedResponse,
        rater: Rater,
        id: Uuid,
        rating: Option<Rating>,
        note: Option<String>,
        surface: Surface,
        trace_id: Option<String>,
    ) -> Result<FeedbackState, FeedbackError> {
        // A program never writes, whatever else is wrong with the request.
        if rater == Rater::Program {
            return Err(FeedbackError::ProgramRun);
        }
        let (user, subject) = rated_subject(&response)?;
        record_subject(&subject);
        self.require_flag(&user).await?;
        if !surface.shows(subject.kind()) {
            return Err(FeedbackError::Invalid(
                "surface does not show this kind of response",
            ));
        }

        let note = Note::parse(note)?;
        if let Some(note) = &note {
            tracing::Span::current()
                .record("agent_feedback.note_len", note.as_str().chars().count());
        }
        let context = self.context(response).await?;

        let outcome = self
            .repo
            .append_if_changed(&FeedbackWrite {
                id,
                user,
                subject,
                rating,
                note,
                surface,
                context,
                trace_id,
            })
            .await
            .map_err(FeedbackError::Unavailable)?;

        let (name, state) = match outcome {
            AppendOutcome::Created(state) => ("created", state),
            AppendOutcome::Unchanged(state) => ("unchanged", state),
            AppendOutcome::Replayed(state) => ("replayed", state),
            AppendOutcome::IdTaken => return Err(FeedbackError::IdTaken),
        };
        tracing::Span::current().record("agent_feedback.outcome", name);
        Ok(state)
    }

    /// What produced the response, read from the crates that own it. A
    /// message must be in the parent the receipt is for and written by an
    /// agent; a run must belong to the routine the receipt is for.
    async fn context(&self, response: RatedResponse) -> Result<ResponseContext, FeedbackError> {
        match response {
            RatedResponse::AgentSessionTurn { session, .. } => {
                let session_id = session_id_of(&session)?;
                self.session_context(session_id).await
            }
            RatedResponse::Message {
                parent,
                access,
                message_id,
            } => {
                let message = self
                    .messages
                    .get(access, message_id)
                    .await
                    .map_err(message_error)?;

                let mut context = ResponseContext {
                    message_parent_type: Some(parent.entity_type()),
                    ..ResponseContext::default()
                };
                if let Some(bot) = message.sender_id.as_bot() {
                    context.agent_bot_id = Some(bot.bot_id());
                    context.agent_kind = Some(AgentKind::of_bot(bot.bot_id()));
                } else if let Some(user) = message.sender_id.as_user()
                    && self
                        .accounts
                        .is_agent_account(user)
                        .await
                        .map_err(FeedbackError::Unavailable)?
                {
                    context.agent_user_id = Some(user.clone());
                    context.agent_kind = Some(AgentKind::Teammate);
                } else {
                    return Err(FeedbackError::NotAgentAuthored);
                }

                // An agent's message opens with a link to the session that
                // wrote it; its model and harness come from there.
                if let Some(session_id) = linked_session(&message.content) {
                    let session = self.session_context(session_id).await?;
                    context.agent_session_id = Some(session_id);
                    context.harness = session.harness;
                    context.model = session.model;
                }
                Ok(context)
            }
            RatedResponse::Suggestion {
                user,
                suggestion_id,
            } => {
                // Only the person a suggestion was made for sees it.
                let suggestion = self
                    .suggestions
                    .suggestion(&user, suggestion_id)
                    .await
                    .map_err(FeedbackError::Unavailable)?
                    .ok_or(FeedbackError::Forbidden)?;
                match suggestion.agent_session_id {
                    Some(session_id) => self.session_context(session_id).await,
                    None => Ok(ResponseContext::default()),
                }
            }
            RatedResponse::RoutineRun { routine, run_id } => {
                let routine_id = routine_id_of(&routine)?;
                let run = self
                    .runs
                    .run(routine_id, run_id)
                    .await
                    .map_err(FeedbackError::Unavailable)?
                    .ok_or(FeedbackError::SubjectNotInContainer)?;
                match run.agent_session_id {
                    Some(session_id) => self.session_context(session_id).await,
                    None => Ok(ResponseContext::default()),
                }
            }
        }
    }

    /// A session's agent, harness and model; only the id when it is gone.
    async fn session_context(
        &self,
        session_id: AgentSessionId,
    ) -> Result<ResponseContext, FeedbackError> {
        let facts = self
            .sessions
            .session(session_id)
            .await
            .map_err(FeedbackError::Unavailable)?;
        let mut context = ResponseContext {
            agent_session_id: Some(session_id),
            ..ResponseContext::default()
        };
        if let Some(facts) = facts {
            context.agent_bot_id = Some(facts.bot_id);
            context.agent_kind = Some(AgentKind::of_bot(facts.bot_id));
            context.harness = Some(facts.harness);
            context.model = Some(facts.model);
        }
        Ok(context)
    }
}

impl<Repo, Flags, Sessions, Runs, Accounts, Suggs> FeedbackApi
    for FeedbackService<Repo, Flags, Sessions, Runs, Accounts, Suggs>
where
    Repo: FeedbackRepo,
    Flags: FeatureFlags + 'static,
    Sessions: AgentSessions,
    Runs: RoutineRuns,
    Accounts: AgentAccounts,
    Suggs: Suggestions,
{
    #[tracing::instrument(name = "agent_feedback.rate", err(level = Level::INFO), skip_all, fields(
        agent_feedback.subject_kind = Empty,
        agent_feedback.surface = request.surface.as_ref(),
        agent_feedback.rating = request.rating.as_ref(),
        agent_feedback.note_len = Empty,
        agent_feedback.outcome = Empty,
        agent.session.id = Empty,
        agent.turn = Empty,
        message.id = Empty,
        message.parent_id = Empty,
        routine.id = Empty,
        routine.run.id = Empty,
        suggestion.id = Empty,
    ))]
    async fn rate(
        &self,
        response: RatedResponse,
        request: RateRequest,
    ) -> Result<FeedbackState, FeedbackError> {
        self.write(
            response,
            request.rater,
            request.id,
            Some(request.rating),
            request.note,
            request.surface,
            request.trace_id,
        )
        .await
    }

    #[tracing::instrument(name = "agent_feedback.retract", err(level = Level::INFO), skip_all, fields(
        agent_feedback.subject_kind = Empty,
        agent_feedback.surface = request.surface.as_ref(),
        agent_feedback.outcome = Empty,
        agent.session.id = Empty,
        agent.turn = Empty,
        message.id = Empty,
        message.parent_id = Empty,
        routine.id = Empty,
        routine.run.id = Empty,
        suggestion.id = Empty,
    ))]
    async fn retract(
        &self,
        response: RatedResponse,
        request: RetractRequest,
    ) -> Result<(), FeedbackError> {
        self.write(
            response,
            request.rater,
            request.id,
            None,
            None,
            request.surface,
            request.trace_id,
        )
        .await
        .map(|_| ())
    }

    #[tracing::instrument(name = "agent_feedback.mine", err(level = Level::INFO), skip_all, fields(
        agent_feedback.subject_kind = Empty,
        agent_feedback.containers = Empty,
        count = Empty,
    ))]
    async fn mine(&self, container: FeedbackContainer) -> Result<Vec<MyFeedback>, FeedbackError> {
        let (user, kind, container_ids) = match &container {
            FeedbackContainer::AgentSession(session) => (
                user_of(session)?,
                SubjectKind::AgentSessionTurn,
                vec![session_id_of(session)?.as_uuid().to_string()],
            ),
            FeedbackContainer::MessageParent { parent, access } => {
                ensure_parent(parent, access)?;
                (
                    user_of(access)?,
                    SubjectKind::Message,
                    vec![parent.entity_id()],
                )
            }
            FeedbackContainer::Routine(routine) => (
                user_of(routine)?,
                SubjectKind::RoutineRun,
                vec![routine_id_of(routine)?.to_string()],
            ),
            // The person's own rows only, and a person rates only their own
            // suggestions: another person's suggestion has no rows to list.
            FeedbackContainer::Suggestions { user, ids } => {
                // Each suggestion once, so a repeated id neither repeats its
                // rating nor counts twice against the limit.
                let ids: BTreeSet<&Uuid> = ids.iter().collect();
                if ids.len() > MAX_SUGGESTIONS_LISTED {
                    return Err(FeedbackError::Invalid("at most 100 suggestion ids"));
                }
                (
                    user.clone(),
                    SubjectKind::Suggestion,
                    ids.into_iter().map(Uuid::to_string).collect(),
                )
            }
        };
        let span = tracing::Span::current();
        span.record("agent_feedback.subject_kind", kind.as_ref());
        span.record("agent_feedback.containers", container_ids.len());
        self.require_flag(&user).await?;

        let mine = self
            .repo
            .current_in_containers(&user, kind, &container_ids)
            .await
            .map_err(FeedbackError::Unavailable)?;
        span.record("count", mine.len());
        Ok(mine)
    }

    #[tracing::instrument(name = "agent_feedback.export", err, skip_all, fields(
        limit = limit.get(),
        count = Empty,
    ))]
    async fn export(
        &self,
        after: Option<ExportCursor>,
        limit: ExportLimit,
    ) -> Result<ExportPage, FeedbackError> {
        let items = self
            .repo
            .events_after(after, limit)
            .await
            .map_err(FeedbackError::Unavailable)?;
        tracing::Span::current().record("count", items.len());

        // A full page may have more after it; a short one is the end.
        let next = (items.len() == usize::from(limit.get()))
            .then(|| items.last())
            .flatten()
            .map(|last| ExportCursor {
                after_created_at: last.created_at,
                after_id: last.id,
            });
        Ok(ExportPage { items, next })
    }
}

/// Who rates, and what, from a response and the receipt for its container.
fn rated_subject(
    response: &RatedResponse,
) -> Result<(MacroUserIdStr<'static>, FeedbackSubject), FeedbackError> {
    match response {
        RatedResponse::AgentSessionTurn { session, turn } => {
            // Stored as a Postgres integer.
            if i32::try_from(*turn).is_err() {
                return Err(FeedbackError::Invalid("turn is out of range"));
            }
            Ok((
                user_of(session)?,
                FeedbackSubject::AgentSessionTurn {
                    session_id: session_id_of(session)?,
                    turn: *turn,
                },
            ))
        }
        RatedResponse::Message {
            parent,
            access,
            message_id,
        } => {
            ensure_parent(parent, access)?;
            Ok((
                user_of(access)?,
                FeedbackSubject::Message {
                    parent: parent.clone(),
                    message_id: *message_id,
                },
            ))
        }
        RatedResponse::Suggestion {
            user,
            suggestion_id,
        } => Ok((
            user.clone(),
            FeedbackSubject::Suggestion {
                suggestion_id: *suggestion_id,
            },
        )),
        RatedResponse::RoutineRun { routine, run_id } => Ok((
            user_of(routine)?,
            FeedbackSubject::RoutineRun {
                routine_id: routine_id_of(routine)?,
                run_id: *run_id,
            },
        )),
    }
}

/// Put the rated response's ids on the current span.
fn record_subject(subject: &FeedbackSubject) {
    let span = tracing::Span::current();
    span.record("agent_feedback.subject_kind", subject.kind().as_ref());
    match subject {
        FeedbackSubject::AgentSessionTurn { session_id, turn } => {
            span.record("agent.session.id", session_id.as_uuid().to_string());
            span.record("agent.turn", turn);
        }
        FeedbackSubject::Message { parent, message_id } => {
            span.record("message.id", message_id.to_string());
            span.record("message.parent_id", parent.entity_id());
        }
        FeedbackSubject::RoutineRun { routine_id, run_id } => {
            span.record("routine.id", routine_id.to_string());
            span.record("routine.run.id", run_id.to_string());
        }
        FeedbackSubject::Suggestion { suggestion_id } => {
            span.record("suggestion.id", suggestion_id.to_string());
        }
    }
}

/// The person a receipt was minted for. Ratings are a person's own: bot,
/// internal and anonymous receipts rate nothing.
fn user_of<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<MacroUserIdStr<'static>, FeedbackError> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| FeedbackError::Forbidden)
}

/// The session a session receipt is for.
fn session_id_of<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<AgentSessionId, FeedbackError> {
    entity_uuid(receipt, EntityType::AgentSession).map(AgentSessionId::new_from_uuid)
}

/// The routine a routine receipt is for.
fn routine_id_of<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<Uuid, FeedbackError> {
    entity_uuid(receipt, EntityType::ScheduledAction)
}

fn entity_uuid<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    expected: EntityType,
) -> Result<Uuid, FeedbackError> {
    let entity = receipt.entity();
    if entity.entity_type != expected {
        return Err(FeedbackError::Forbidden);
    }
    entity
        .entity_id
        .parse()
        .map_err(|_| FeedbackError::Forbidden)
}

/// The message receipt must be for the parent the route names.
fn ensure_parent<T: RequiredPermission>(
    parent: &MessageParent,
    access: &EntityAccessReceipt<T>,
) -> Result<(), FeedbackError> {
    let entity = access.entity();
    if entity.entity_type != parent.access_entity_type() || entity.entity_id != parent.entity_id() {
        return Err(FeedbackError::Forbidden);
    }
    Ok(())
}

/// The session a message's leading `<m-agent-session-mention>` links to, the
/// way the app shows it on an agent's message.
fn linked_session(content: &str) -> Option<AgentSessionId> {
    let parsed = ParsedXmlText::parse_lenient(content);
    match parsed.0.first() {
        Some(TextSegment::Xml(XmlTag::AgentSession(mention))) => {
            mention.id.parse().ok().map(AgentSessionId::new_from_uuid)
        }
        _ => None,
    }
}

fn message_error(error: MessageError) -> FeedbackError {
    match error {
        MessageError::NotFound => FeedbackError::SubjectNotInContainer,
        MessageError::Forbidden => FeedbackError::Forbidden,
        MessageError::Invalid(message) => FeedbackError::Invalid(message),
        MessageError::Conflict => {
            FeedbackError::Unavailable(rootcause::report!("unexpected message conflict on read"))
        }
        MessageError::Repository(error) => FeedbackError::Unavailable(error),
    }
}
