//! The suggestions service: the person's feed and the tools hidden generation
//! sessions write it with.
//!
//! Code here only validates and stores. Which suggestions exist, how they are
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
    Change, ChangeAction, GenerationSession, KindName, NewSuggestion, RetireSuggestionRequest,
    RewriteSuggestion, RunMode, SessionKind, Suggestion, SuggestionContent, SuggestionError,
    SuggestionFeed, SuggestionKind, SuggestionState, SuggestionWriteOutcome, SuggestionsReview,
    Target,
};
use super::ports::{
    Limits, RequestSessions, SuggestionAccess, SuggestionApi, SuggestionRepo, Written,
};

#[cfg(test)]
mod test;

/// The PostHog flag that turns suggestions on for a person.
pub const SUGGESTIONS_FLAG: &str = "enable-suggestions";
/// Most open suggestions a person may have.
pub const OPEN_LIMIT: u32 = 30;
/// Most suggestions one generation may add or bring back.
pub const NEW_PER_GENERATION: u32 = 12;

/// How long a finished suggestion stays in the feed's `done`.
pub const DONE_WITHIN: chrono::TimeDelta = chrono::TimeDelta::hours(24);

/// Suggestions whose items the feed checks at once.
const ACCESS_CHECKS_AT_ONCE: usize = 8;

/// How many of the person's closed suggestions a session's review shows, most
/// recently closed first: enough not to suggest again what they just turned
/// down. Older ones still count: proposing one comes back to the same row.
const REVIEW_CLOSED: u32 = 60;

const LIMITS: Limits = Limits {
    open: OPEN_LIMIT,
    new_per_generation: NEW_PER_GENERATION,
};

/// Serves suggestions from `Repo`, checking items with `Access`.
pub struct SuggestionService<Repo, Access, Flags> {
    repo: Arc<Repo>,
    access: Arc<Access>,
    request_sessions: Arc<dyn RequestSessions>,
    flags: Option<Flags>,
}

impl<Repo, Access, Flags> SuggestionService<Repo, Access, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Flags: FeatureFlags + 'static,
{
    /// Without `flags`, suggestions are off for everyone.
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

    #[tracing::instrument(name = "suggestions.flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<(), SuggestionError> {
        let Some(flags) = &self.flags else {
            return Err(SuggestionError::NotFound);
        };
        let enabled = flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; suggestions stay off");
            })
            .is_ok_and(|flags| flags.is_enabled(SUGGESTIONS_FLAG));
        if enabled {
            Ok(())
        } else {
            Err(SuggestionError::NotFound)
        }
    }

    /// The person's open suggestions session the request came from.
    async fn session(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<GenerationSession, SuggestionError> {
        let owner = principal.owner();
        let user = owner.as_user().ok_or(SuggestionError::NotGenerating)?;
        let session = match correlation {
            Some(correlation) => self
                .request_sessions
                .session_of(correlation)
                .await
                .map_err(SuggestionError::Internal)?,
            None => None,
        };
        let session = match session {
            Some(session) => self
                .repo
                .generation_session(session)
                .await
                .map_err(SuggestionError::internal)?,
            None => None,
        };
        let session = session
            .filter(|session| session.user == *user && session.kind == SessionKind::Suggestions)
            .ok_or(SuggestionError::NotGenerating)?;
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
    ) -> Result<(), SuggestionError> {
        for target in targets {
            let mut viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(SuggestionError::internal)?;
            if let Some(part) = target.part_id.as_deref().filter(|_| viewable) {
                viewable = self
                    .access
                    .is_part_of(target, part)
                    .await
                    .map_err(SuggestionError::internal)?;
            }
            if !viewable {
                let item = target.entity_type.as_ref();
                problems.push(match &target.part_id {
                    Some(part) => format!(
                        "the user can't open {item} `{}`, or `{part}` isn't one of its parts \
                         (a message of a channel or email thread); a suggestion is only about \
                         items they can open",
                        target.entity_id
                    ),
                    None => format!(
                        "the user can't open {item} `{}`; a suggestion is only about items they \
                         can open",
                        target.entity_id
                    ),
                });
            }
        }
        Ok(())
    }

    /// Whether the person can open every item `suggestion` is about.
    async fn viewable(
        &self,
        user: &MacroUserIdStr<'_>,
        suggestion: &Suggestion,
    ) -> Result<bool, SuggestionError> {
        for target in &suggestion.about {
            let viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(SuggestionError::internal)?;
            if !viewable {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The suggestion as stored after a write.
    async fn reread(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        match self
            .repo
            .suggestion(user, id)
            .await
            .map_err(SuggestionError::internal)?
        {
            Some(suggestion) => Ok(SuggestionWriteOutcome::applied(suggestion)),
            None => Err(SuggestionError::NotFound),
        }
    }
}

/// A write's outcome as a problem the session can act on.
fn written_problem(written: Written) -> Option<String> {
    match written {
        Written::Applied => None,
        Written::OverOpenLimit => Some(format!(
            "the user has {OPEN_LIMIT} open suggestions; retire one that matters less first"
        )),
        Written::OverNewLimit => Some(format!(
            "this generation added {NEW_PER_GENERATION} suggestions, the most for one night; stop adding"
        )),
        Written::Conflict => Some(
            "the suggestion changed while you wrote it; read it again with `macro.suggestions.review` and retry"
                .to_owned(),
        ),
    }
}

fn snapshot(content: &SuggestionContent) -> Option<serde_json::Value> {
    serde_json::to_value(content).ok()
}

impl<Repo, Access, Flags> SuggestionApi for SuggestionService<Repo, Access, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "suggestions.feed", skip_all, fields(
        suggestions.open = tracing::field::Empty,
        suggestions.done = tracing::field::Empty,
        suggestions.hidden = tracing::field::Empty,
    ), err)]
    async fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<SuggestionFeed, SuggestionError> {
        self.require_flag(user).await?;
        let done_since = Utc::now() - DONE_WITHIN;
        let shown: Vec<Suggestion> = self
            .repo
            .shown(user, done_since)
            .await
            .map_err(SuggestionError::internal)?;
        let before = shown.len();
        // Up to 30 suggestions of up to 5 items each: check a few at a time.
        let viewable: Vec<Suggestion> = futures::stream::iter(shown)
            .map(|suggestion| async move {
                Ok::<_, SuggestionError>(
                    self.viewable(user, &suggestion)
                        .await?
                        .then_some(suggestion),
                )
            })
            .buffer_unordered(ACCESS_CHECKS_AT_ONCE)
            .try_filter_map(|suggestion| async move { Ok(suggestion) })
            .try_collect()
            .await?;
        let hidden = before - viewable.len();
        let (mut suggestions, mut done): (Vec<Suggestion>, Vec<Suggestion>) = viewable
            .into_iter()
            .partition(|suggestion| suggestion.state.is_open());
        suggestions.sort_by(|a, b| {
            b.importance
                .cmp(&a.importance)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        done.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let span = tracing::Span::current();
        span.record("suggestions.open", suggestions.len());
        span.record("suggestions.done", done.len());
        span.record("suggestions.hidden", hidden);
        Ok(SuggestionFeed { suggestions, done })
    }

    #[tracing::instrument(name = "suggestions.accept", skip_all, fields(suggestion.id = %id), err)]
    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<(), SuggestionError> {
        self.require_flag(user).await?;
        let suggestion = self
            .repo
            .suggestion(user, id)
            .await
            .map_err(SuggestionError::internal)?
            .ok_or(SuggestionError::NotFound)?;
        // A background prompt is taken on and runs; anything else the person
        // acts on themself (opens the item, the composer, the routine) is
        // done when they do. Accepting a done suggestion again changes nothing.
        let background = matches!(
            suggestion.kind,
            SuggestionKind::Prompt {
                run_mode: RunMode::Background,
                ..
            }
        );
        let to = if background {
            SuggestionState::Accepted
        } else {
            SuggestionState::Done
        };
        if suggestion.state == to {
            return Ok(());
        }
        let from: &[SuggestionState] = if background {
            &[SuggestionState::Proposed]
        } else {
            &[SuggestionState::Proposed, SuggestionState::Accepted]
        };
        let moved = self
            .repo
            .set_state(user, id, from, to, None, Utc::now())
            .await
            .map_err(SuggestionError::internal)?;
        if !moved {
            return Err(SuggestionError::NotFound);
        }
        tracing::info!(event = "suggestions.accepted", done = !background);
        Ok(())
    }

    #[tracing::instrument(name = "suggestions.dismiss", skip_all, fields(suggestion.id = %id), err)]
    async fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<(), SuggestionError> {
        self.require_flag(user).await?;
        let moved = self
            .repo
            .set_state(
                user,
                id,
                &[SuggestionState::Proposed, SuggestionState::Accepted],
                SuggestionState::Dismissed,
                None,
                Utc::now(),
            )
            .await
            .map_err(SuggestionError::internal)?;
        if !moved {
            return Err(SuggestionError::NotFound);
        }
        tracing::info!(event = "suggestions.dismissed");
        Ok(())
    }

    #[tracing::instrument(name = "suggestions.review", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestions.count = tracing::field::Empty,
    ), err)]
    async fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<SuggestionsReview, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let (suggestions, added) = tokio::try_join!(
            async {
                self.repo
                    .for_review(&session.user, REVIEW_CLOSED)
                    .await
                    .map_err(SuggestionError::internal)
            },
            async {
                self.repo
                    .added_in(session.generation)
                    .await
                    .map_err(SuggestionError::internal)
            },
        )?;
        let (mut open, mut closed): (Vec<Suggestion>, Vec<Suggestion>) = suggestions
            .into_iter()
            .partition(|suggestion| suggestion.state.is_open());
        open.sort_by(|a, b| b.importance.cmp(&a.importance));
        closed.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let open_count = u32::try_from(open.len()).unwrap_or(u32::MAX);
        open.append(&mut closed);
        tracing::Span::current().record("suggestions.count", open.len());
        Ok(SuggestionsReview {
            suggestions: open,
            open: open_count,
            open_limit: OPEN_LIMIT,
            new_left: NEW_PER_GENERATION.saturating_sub(added),
        })
    }

    #[tracing::instrument(name = "suggestions.suggest", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.kind = request.kind.as_ref(),
        suggestion.id = tracing::field::Empty,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: NewSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
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
        let content = SuggestionContent {
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
            .map_err(SuggestionError::internal)?;
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
                .map_err(SuggestionError::internal)?;
            if let Some(problem) = written_problem(written) {
                return Ok(rejected(&span, vec![problem]));
            }
            span.record("suggestion.id", id.to_string());
            span.record("suggestion.outcome", "created");
            return self.reread(&user, id).await;
        };
        span.record("suggestion.id", existing.id.to_string());
        if existing.kind.name() != request.kind {
            return Ok(rejected(
                &span,
                vec![format!(
                    "`{}` is a {} suggestion and a kind never changes; use another `dedupKey`",
                    existing.dedup_key,
                    existing.kind.name().as_ref()
                )],
            ));
        }
        let same_kind_data = match (&existing.kind, &kind) {
            (
                SuggestionKind::Prompt { run_mode, .. },
                super::model::NewKind::Prompt { run_mode: asked },
            ) => run_mode == asked,
            (
                SuggestionKind::Entity { action, .. },
                super::model::NewKind::Entity { action: asked },
            ) => action == asked,
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
            SuggestionState::Proposed | SuggestionState::Accepted => {
                (ChangeAction::Rewritten, existing.state)
            }
            SuggestionState::Dismissed => {
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
                (ChangeAction::Restored, SuggestionState::Proposed)
            }
            SuggestionState::Done | SuggestionState::Resolved | SuggestionState::Retired => {
                (ChangeAction::Restored, SuggestionState::Proposed)
            }
        };
        let change = Change {
            session: session.session,
            generation: session.generation,
            action,
            old: snapshot(&SuggestionContent::of(&existing)),
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
            .map_err(SuggestionError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("suggestion.outcome", action.as_ref());
        self.reread(&user, existing.id).await
    }

    #[tracing::instrument(name = "suggestions.rewrite", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.id = %id,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .suggestion(&user, id)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Err(SuggestionError::NotFound);
        };
        let mut problems = Vec::new();
        if !existing.state.is_open() {
            problems.push(format!(
                "this suggestion is {}; only open suggestions are rewritten, and `macro.suggestions.suggest` with \
                 its `dedupKey` brings one back",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "routine suggestions follow their routine suggestion, which is never rewritten"
                    .to_owned(),
            );
        }
        if request.prompt.is_some() && existing.kind.name() != KindName::Prompt {
            problems.push("`prompt` is only for prompt suggestions".to_owned());
        }
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        let mut content = SuggestionContent::of(&existing);
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
                problems
                    .push("an entity suggestion is about at least one item in `about`".to_owned());
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
            old: snapshot(&SuggestionContent::of(&existing)),
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
            .map_err(SuggestionError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("suggestion.outcome", "rewritten");
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "suggestions.retire", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.id = %id,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireSuggestionRequest,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .suggestion(&user, id)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Err(SuggestionError::NotFound);
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
                "this suggestion is {} already, not open",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "retire a routine suggestion by retiring its routine suggestion in a routines session"
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
                SuggestionState::Retired.as_ref().to_owned(),
            )),
            reason,
            at: Utc::now(),
        };
        let moved = self
            .repo
            .set_state(
                &user,
                id,
                &[SuggestionState::Proposed, SuggestionState::Accepted],
                SuggestionState::Retired,
                Some(&change),
                change.at,
            )
            .await
            .map_err(SuggestionError::internal)?;
        if !moved {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record("suggestion.outcome", "retired");
        self.reread(&user, id).await
    }
}

fn rejected(span: &tracing::Span, problems: Vec<String>) -> SuggestionWriteOutcome {
    span.record("suggestion.outcome", "rejected");
    span.record("suggestion.problems", problems.len());
    SuggestionWriteOutcome::rejected(problems)
}
