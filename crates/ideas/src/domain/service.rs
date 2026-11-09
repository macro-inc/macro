//! The ideas service: the person's feed and the tools hidden generation
//! sessions write it with.
//!
//! Code here only validates and stores. Which ideas exist, how they are
//! worded and ranked, and when one stops mattering are all decided by the
//! generation sessions through these tools; a refused write answers with
//! problems the session can read and fix. Every accepted write is logged in
//! the change log with the values before and after and the session's reason.

use std::sync::Arc;

use chrono::Utc;
use feature_flags::FeatureFlags;
use futures::{StreamExt as _, TryStreamExt as _};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::CreationPrincipal;

use super::check;
use super::model::{
    Change, ChangeAction, GenerationSession, Idea, IdeaContent, IdeaError, IdeaKind, IdeaReview,
    IdeaState, IdeaWriteOutcome, Ideas, KindName, RetireIdea, RewriteIdea, SessionKind,
    SuggestIdea, Target,
};
use super::ports::{IdeaAccess, IdeaApi, IdeaRepo, Limits, RequestSessions, Written};

#[cfg(test)]
mod test;

/// The PostHog flag that turns ideas on for a person.
pub const IDEAS_FLAG: &str = "enable-ideas";
/// Most open ideas a person may have.
pub const OPEN_LIMIT: u32 = 30;
/// Most ideas one generation may add or bring back.
pub const NEW_PER_GENERATION: u32 = 10;

/// Ideas whose items the feed checks at once.
const ACCESS_CHECKS_AT_ONCE: usize = 8;

const LIMITS: Limits = Limits {
    open: OPEN_LIMIT,
    new_per_generation: NEW_PER_GENERATION,
};

/// Serves ideas from `Repo`, checking items with `Access`.
pub struct IdeaService<Repo, Access, Flags> {
    repo: Arc<Repo>,
    access: Arc<Access>,
    request_sessions: Arc<dyn RequestSessions>,
    flags: Option<Flags>,
}

impl<Repo, Access, Flags> IdeaService<Repo, Access, Flags>
where
    Repo: IdeaRepo,
    Access: IdeaAccess,
    Flags: FeatureFlags + 'static,
{
    /// Without `flags`, ideas are off for everyone.
    pub fn new(
        repo: Arc<Repo>,
        access: Arc<Access>,
        request_sessions: Arc<dyn RequestSessions>,
        flags: Option<Flags>,
    ) -> Self {
        Self {
            repo,
            access,
            request_sessions,
            flags,
        }
    }

    #[tracing::instrument(name = "ideas.flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<(), IdeaError> {
        let Some(flags) = &self.flags else {
            return Err(IdeaError::NotFound);
        };
        let enabled = flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; ideas stay off");
            })
            .is_ok_and(|flags| flags.is_enabled(IDEAS_FLAG));
        if enabled {
            Ok(())
        } else {
            Err(IdeaError::NotFound)
        }
    }

    /// The person's open ideas session the request came from.
    async fn session(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<GenerationSession, IdeaError> {
        let owner = principal.owner();
        let user = owner.as_user().ok_or(IdeaError::NotGenerating)?;
        let session = match correlation {
            Some(correlation) => self
                .request_sessions
                .session_of(correlation)
                .await
                .map_err(IdeaError::Internal)?,
            None => None,
        };
        let session = match session {
            Some(session) => self
                .repo
                .generation_session(session)
                .await
                .map_err(IdeaError::internal)?,
            None => None,
        };
        let session = session
            .filter(|session| session.user == *user && session.kind == SessionKind::Ideas)
            .ok_or(IdeaError::NotGenerating)?;
        self.require_flag(&session.user).await?;
        let span = tracing::Span::current();
        span.record("agent.session.id", session.session.to_string());
        span.record("suggestion.generation.id", session.generation.to_string());
        Ok(session)
    }

    /// Items in `targets` the person can't open, as problems.
    async fn inaccessible(
        &self,
        user: &MacroUserIdStr<'_>,
        targets: &[Target],
        problems: &mut Vec<String>,
    ) -> Result<(), IdeaError> {
        for target in targets {
            let viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(IdeaError::internal)?;
            if !viewable {
                problems.push(format!(
                    "the user can't open {} `{}`; an idea is only about items they can open",
                    target.entity_type.as_ref(),
                    target.entity_id
                ));
            }
        }
        Ok(())
    }

    /// Whether the person can open every item `idea` is about.
    async fn viewable(&self, user: &MacroUserIdStr<'_>, idea: &Idea) -> Result<bool, IdeaError> {
        for target in &idea.about {
            let viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(IdeaError::internal)?;
            if !viewable {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The idea as stored after a write.
    async fn reread(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        match self
            .repo
            .idea(user, id)
            .await
            .map_err(IdeaError::internal)?
        {
            Some(idea) => Ok(IdeaWriteOutcome::applied(idea)),
            None => Err(IdeaError::NotFound),
        }
    }
}

/// A write's outcome as a problem the session can act on.
fn written_problem(written: Written) -> Option<String> {
    match written {
        Written::Applied => None,
        Written::OverOpenLimit => Some(format!(
            "the user has {OPEN_LIMIT} open ideas; retire one that matters less first"
        )),
        Written::OverNewLimit => Some(format!(
            "this generation added {NEW_PER_GENERATION} ideas, the most for one night; stop adding"
        )),
        Written::Conflict => Some(
            "the idea changed while you wrote it; read it again with `macro.ideas.review` and retry"
                .to_owned(),
        ),
    }
}

fn snapshot(content: &IdeaContent) -> Option<serde_json::Value> {
    serde_json::to_value(content).ok()
}

impl<Repo, Access, Flags> IdeaApi for IdeaService<Repo, Access, Flags>
where
    Repo: IdeaRepo,
    Access: IdeaAccess,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "ideas.feed", skip_all, fields(
        ideas.open = tracing::field::Empty,
        ideas.hidden = tracing::field::Empty,
    ), err)]
    async fn feed(&self, user: &MacroUserIdStr<'static>) -> Result<Ideas, IdeaError> {
        self.require_flag(user).await?;
        let open: Vec<Idea> = self
            .repo
            .ideas(user)
            .await
            .map_err(IdeaError::internal)?
            .into_iter()
            .filter(|idea| idea.state.is_open())
            .collect();
        let before = open.len();
        // Up to 30 ideas of up to 5 items each: check a few at a time.
        let mut ideas: Vec<Idea> = futures::stream::iter(open)
            .map(|idea| async move {
                Ok::<_, IdeaError>(self.viewable(user, &idea).await?.then_some(idea))
            })
            .buffer_unordered(ACCESS_CHECKS_AT_ONCE)
            .try_filter_map(|idea| async move { Ok(idea) })
            .try_collect()
            .await?;
        ideas.sort_by(|a, b| {
            b.importance
                .cmp(&a.importance)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        let span = tracing::Span::current();
        span.record("ideas.open", ideas.len());
        span.record("ideas.hidden", before - ideas.len());
        Ok(Ideas { ideas })
    }

    #[tracing::instrument(name = "ideas.accept", skip_all, fields(idea.id = %id), err)]
    async fn accept(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), IdeaError> {
        self.require_flag(user).await?;
        let moved = self
            .repo
            .set_state(
                user,
                id,
                &[IdeaState::Proposed],
                IdeaState::Accepted,
                None,
                Utc::now(),
            )
            .await
            .map_err(IdeaError::internal)?;
        if !moved {
            return Err(IdeaError::NotFound);
        }
        tracing::info!(event = "ideas.accepted");
        Ok(())
    }

    #[tracing::instrument(name = "ideas.dismiss", skip_all, fields(idea.id = %id), err)]
    async fn dismiss(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), IdeaError> {
        self.require_flag(user).await?;
        let moved = self
            .repo
            .set_state(
                user,
                id,
                &[IdeaState::Proposed, IdeaState::Accepted],
                IdeaState::Dismissed,
                None,
                Utc::now(),
            )
            .await
            .map_err(IdeaError::internal)?;
        if !moved {
            return Err(IdeaError::NotFound);
        }
        tracing::info!(event = "ideas.dismissed");
        Ok(())
    }

    #[tracing::instrument(name = "ideas.review", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        ideas.count = tracing::field::Empty,
    ), err)]
    async fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<IdeaReview, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let (ideas, added) = tokio::try_join!(
            async {
                self.repo
                    .ideas(&session.user)
                    .await
                    .map_err(IdeaError::internal)
            },
            async {
                self.repo
                    .added_in(session.generation)
                    .await
                    .map_err(IdeaError::internal)
            },
        )?;
        let (mut open, mut closed): (Vec<Idea>, Vec<Idea>) =
            ideas.into_iter().partition(|idea| idea.state.is_open());
        open.sort_by(|a, b| b.importance.cmp(&a.importance));
        closed.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let open_count = u32::try_from(open.len()).unwrap_or(u32::MAX);
        open.append(&mut closed);
        tracing::Span::current().record("ideas.count", open.len());
        Ok(IdeaReview {
            ideas: open,
            open: open_count,
            open_limit: OPEN_LIMIT,
            new_left: NEW_PER_GENERATION.saturating_sub(added),
        })
    }

    #[tracing::instrument(name = "ideas.suggest", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        idea.kind = request.kind.as_ref(),
        idea.id = tracing::field::Empty,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let mut problems = Vec::new();
        let kind = check::new_kind(&request, &mut problems);
        let content = (
            check::dedup_key(&request.dedup_key, &mut problems),
            check::text(
                &request.title,
                "`title`",
                check::MAX_TITLE_CHARS,
                &mut problems,
            ),
            check::text(
                &request.summary,
                "`summary`",
                check::MAX_SUMMARY_CHARS,
                &mut problems,
            ),
            check::importance(request.importance, &mut problems),
            check::targets(request.about, &mut problems),
            request
                .prompt
                .as_deref()
                .map(|prompt| check::prompt(prompt, &mut problems)),
        );
        let reason = request.reason.as_deref().and_then(|reason| {
            check::text(reason, "`reason`", check::MAX_REASON_CHARS, &mut problems)
        });
        let (
            Some(kind),
            (Some(dedup_key), Some(title), Some(summary), Some(importance), Some(about), prompt),
        ) = (kind, content)
        else {
            return Ok(rejected(&span, problems));
        };
        let prompt = match prompt {
            Some(Some(prompt)) => Some(prompt),
            Some(None) => return Ok(rejected(&span, problems)),
            None => None,
        };
        self.inaccessible(&user, &about, &mut problems).await?;
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let content = IdeaContent {
            dedup_key,
            title,
            summary,
            importance,
            categories: check::categories(request.categories),
            about,
            prompt,
        };
        let now = Utc::now();
        let existing = self
            .repo
            .by_dedup_key(&user, &content.dedup_key)
            .await
            .map_err(IdeaError::internal)?;
        let Some(existing) = existing else {
            let id = Uuid::now_v7();
            let change = Change {
                session: session.session,
                generation: session.generation,
                action: ChangeAction::Created,
                old: None,
                new: snapshot(&content),
                reason,
                at: now,
            };
            let written = self
                .repo
                .create(&user, id, &kind, &content, LIMITS, &change)
                .await
                .map_err(IdeaError::internal)?;
            if let Some(problem) = written_problem(written) {
                return Ok(rejected(&span, vec![problem]));
            }
            span.record("idea.id", id.to_string());
            span.record("idea.outcome", "created");
            return self.reread(&user, id).await;
        };
        span.record("idea.id", existing.id.to_string());
        if existing.kind.name() != request.kind {
            return Ok(rejected(
                &span,
                vec![format!(
                    "`{}` is a {} idea and a kind never changes; use another `dedupKey`",
                    existing.dedup_key,
                    existing.kind.name().as_ref()
                )],
            ));
        }
        let same_kind_data = match (&existing.kind, &kind) {
            (
                IdeaKind::Prompt { run_mode, .. },
                super::model::NewKind::Prompt { run_mode: asked },
            ) => run_mode == asked,
            (IdeaKind::Entity { action, .. }, super::model::NewKind::Entity { action: asked }) => {
                action == asked
            }
            _ => false,
        };
        if !same_kind_data {
            return Ok(rejected(
                &span,
                vec![format!(
                    "`{}` keeps its run mode or action; use another `dedupKey` for a different one",
                    existing.dedup_key
                )],
            ));
        }
        let (action, to) = match existing.state {
            IdeaState::Proposed | IdeaState::Accepted => (ChangeAction::Rewritten, existing.state),
            IdeaState::Dismissed => {
                if reason.is_none() {
                    return Ok(rejected(
                        &span,
                        vec![format!(
                            "the user dismissed `{}` on {}; bring it back only with a `reason` \
                             saying what changed since",
                            existing.dedup_key,
                            existing.state_changed_at.format("%Y-%m-%d")
                        )],
                    ));
                }
                (ChangeAction::Restored, IdeaState::Proposed)
            }
            IdeaState::Done | IdeaState::Resolved | IdeaState::Retired => {
                (ChangeAction::Restored, IdeaState::Proposed)
            }
        };
        let change = Change {
            session: session.session,
            generation: session.generation,
            action,
            old: snapshot(&IdeaContent::of(&existing)),
            new: snapshot(&content),
            reason,
            at: now,
        };
        let written = self
            .repo
            .replace(
                &user,
                existing.id,
                &content,
                existing.state,
                to,
                LIMITS,
                &change,
            )
            .await
            .map_err(IdeaError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("idea.outcome", action.as_ref());
        self.reread(&user, existing.id).await
    }

    #[tracing::instrument(name = "ideas.rewrite", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        idea.id = %id,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .idea(&user, id)
            .await
            .map_err(IdeaError::internal)?
        else {
            return Err(IdeaError::NotFound);
        };
        let mut problems = Vec::new();
        if !existing.state.is_open() {
            problems.push(format!(
                "this idea is {}; only open ideas are rewritten, and `macro.ideas.suggest` with \
                 its `dedupKey` brings one back",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "routine ideas follow their routine suggestion, which is never rewritten"
                    .to_owned(),
            );
        }
        if request.prompt.is_some() && existing.kind.name() != KindName::Prompt {
            problems.push("`prompt` is only for prompt ideas".to_owned());
        }
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        let mut content = IdeaContent::of(&existing);
        if let Some(title) = request.title {
            content.title = check::text(&title, "`title`", check::MAX_TITLE_CHARS, &mut problems)
                .unwrap_or_default();
        }
        if let Some(summary) = request.summary {
            content.summary = check::text(
                &summary,
                "`summary`",
                check::MAX_SUMMARY_CHARS,
                &mut problems,
            )
            .unwrap_or_default();
        }
        if let Some(importance) = request.importance {
            content.importance = check::importance(importance, &mut problems).unwrap_or_default();
        }
        if let Some(categories) = request.categories {
            content.categories = check::categories(categories);
        }
        if let Some(about) = request.about {
            if about.is_empty() && existing.kind.name() == KindName::Entity {
                problems.push("an entity idea is about at least one item in `about`".to_owned());
            }
            if let Some(about) = check::targets(about, &mut problems) {
                self.inaccessible(&user, &about, &mut problems).await?;
                content.about = about;
            }
        }
        if let Some(prompt) = request.prompt {
            content.prompt = check::prompt(&prompt, &mut problems);
        }
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Rewritten,
            old: snapshot(&IdeaContent::of(&existing)),
            new: snapshot(&content),
            reason,
            at: Utc::now(),
        };
        let written = self
            .repo
            .replace(
                &user,
                id,
                &content,
                existing.state,
                existing.state,
                LIMITS,
                &change,
            )
            .await
            .map_err(IdeaError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("idea.outcome", "rewritten");
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "ideas.retire", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        idea.id = %id,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .idea(&user, id)
            .await
            .map_err(IdeaError::internal)?
        else {
            return Err(IdeaError::NotFound);
        };
        let mut problems = Vec::new();
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        if !existing.state.is_open() {
            problems.push(format!(
                "this idea is {} already, not open",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "retire a routine idea by retiring its routine suggestion in a routines session"
                    .to_owned(),
            );
        }
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Retired,
            old: Some(serde_json::Value::String(
                existing.state.as_ref().to_owned(),
            )),
            new: Some(serde_json::Value::String(
                IdeaState::Retired.as_ref().to_owned(),
            )),
            reason,
            at: Utc::now(),
        };
        let moved = self
            .repo
            .set_state(
                &user,
                id,
                &[IdeaState::Proposed, IdeaState::Accepted],
                IdeaState::Retired,
                Some(&change),
                change.at,
            )
            .await
            .map_err(IdeaError::internal)?;
        if !moved {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record("idea.outcome", "retired");
        self.reread(&user, id).await
    }
}

fn rejected(span: &tracing::Span, problems: Vec<String>) -> IdeaWriteOutcome {
    span.record("idea.outcome", "rejected");
    span.record("idea.problems", problems.len());
    IdeaWriteOutcome::rejected(problems)
}
