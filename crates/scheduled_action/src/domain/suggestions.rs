//! Routine suggestions: routines AI suggests for one person, and Macro's
//! catalog routines filling in.
//!
//! Hidden routines sessions of the person's generations (onboarding and
//! nightly, run by the `suggestion_generation` crate, which also runs their
//! ideas sessions) are told what [`RoutineSuggestionApi::brief`] says: the
//! person's newest mail and connected apps as untrusted data, Macro's
//! catalog, and what they dismissed. Each hands back suggestions through
//! `macro.routines.suggest` ([`RoutineSuggestionApi::suggest`]), which only the
//! person's own open routines sessions may call. A suggestion is a catalog
//! routine with bounded knob values, or a routine the session drafted that
//! passes saving's checks; [`decode`] is the boundary. A nightly session also
//! reads what it suggested before (`macro.routines.review`) and retires what
//! no longer fits (`macro.routines.retire`); suggestions are never rewritten.
//! Every kept and retired suggestion is logged in `suggestion_change`.
//!
//! A read serves, per surface, AI's open suggestions best first, then
//! catalog routines marked `suggest` as Macro's templates, to
//! [`PER_SURFACE`], skipping what the person dismissed or saved a routine
//! from. Dismissal is permanent and later generations are told.

pub mod decode;
pub mod model;
pub mod ports;
pub mod prompt;

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::Utc;
use chrono_tz::Tz;
use feature_flags::FeatureFlags;
use ideas::domain::model::{GenerationSession, GenerationTrigger, SessionKind};
use ideas::domain::ports::GenerationSessions;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::CreationPrincipal;
use routine_program::{CATALOG, Surface};

use self::model::{
    GenerationStatus, RetireSuggestion, ReviewedState, ReviewedSuggestion, RoutineGenerationReport,
    RoutineSuggestion, RoutineSuggestions, StoredPick, StoredSuggestion, SuggestOutcome,
    SuggestRequest, SuggestedPick, SuggestionFrom, SuggestionReview,
};
use self::ports::{GenerationStatuses, SuggestionRepo, SuggestionSources};
use super::models::ActionPolicyError;
use super::ports::{
    RequestSessions, RoutineCode, ScheduledActionService, SuggestionOrigin, SuggestionOrigins,
};

#[cfg(test)]
mod test;

/// The PostHog flag that turns routine suggestions on for a person.
pub const ROUTINE_SUGGESTIONS_FLAG: &str = "enable-routine-suggestions";
/// The PostHog flag that lets a person save code steps.
pub const ROUTINE_CODE_STEPS_FLAG: &str = "enable-routine-code-steps";
/// Inbox messages a brief holds.
pub const INBOX_MESSAGES: u16 = 100;
/// Suggestions shown per surface: AI's, then Macro's templates.
pub const PER_SURFACE: usize = 3;
/// AI's catalog picks onboarding shows switched on, at most.
pub const MAX_ON_BY_DEFAULT: usize = 2;
/// The keep estimate a catalog pick needs to be shown switched on.
pub const ON_BY_DEFAULT_KEEP: f32 = 0.6;
/// Suggestions one session may keep.
pub const MAX_KEPT_PER_SESSION: u32 = 12;
/// Names Macro's templates' ids, per person and catalog key.
const TEMPLATE_NAMESPACE: Uuid = Uuid::from_u128(0x7c1f_0b5e_3d2a_4e9b_9a41_5f6c_2d8e_a017);

/// What routines sessions are told to write routines with.
#[derive(Debug, Clone)]
pub struct RoutineBriefing {
    /// The SDK's routines guide, as drafts read it.
    pub guide: &'static str,
    /// The model the Ask AI steps they write run on.
    pub agent_model: String,
}

pub(crate) const ALL_SURFACES: [Surface; 9] = [
    Surface::Email,
    Surface::Calendar,
    Surface::Tasks,
    Surface::Files,
    Surface::Crm,
    Surface::Chat,
    Surface::Calls,
    Surface::Reviews,
    Surface::Agents,
];

/// The id of catalog routine `key` as Macro's template for `user`: the
/// same on every read, so it can be dismissed and saved from.
pub fn template_id(user: &MacroUserIdStr<'_>, key: &str) -> Uuid {
    Uuid::new_v5(
        &TEMPLATE_NAMESPACE,
        format!("{}\n{key}", user.as_ref()).as_bytes(),
    )
}

/// Serves routine suggestions and the tools routines sessions write them
/// with.
pub struct RoutineSuggestionService<Actions, Repo, Sources, Code, Flags> {
    actions: Arc<Actions>,
    repo: Arc<Repo>,
    sources: Arc<Sources>,
    code: Arc<Code>,
    request_sessions: Arc<dyn RequestSessions>,
    generation_sessions: Arc<dyn GenerationSessions>,
    statuses: Arc<dyn GenerationStatuses>,
    flags: Option<Flags>,
    briefing: RoutineBriefing,
}

impl<Actions, Repo, Sources, Code, Flags>
    RoutineSuggestionService<Actions, Repo, Sources, Code, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Code: RoutineCode,
    Flags: FeatureFlags + 'static,
{
    /// Without `flags` suggestions are off for everyone.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        actions: Arc<Actions>,
        repo: Arc<Repo>,
        sources: Arc<Sources>,
        code: Arc<Code>,
        request_sessions: Arc<dyn RequestSessions>,
        generation_sessions: Arc<dyn GenerationSessions>,
        statuses: Arc<dyn GenerationStatuses>,
        flags: Option<Flags>,
        briefing: RoutineBriefing,
    ) -> Self {
        Self {
            actions,
            repo,
            sources,
            code,
            request_sessions,
            generation_sessions,
            statuses,
            flags,
            briefing,
        }
    }

    /// The flags for the person; none when they can't be read.
    async fn flags(&self, user: &MacroUserIdStr<'_>) -> Option<feature_flags::FlagSnapshot> {
        self.flags
            .as_ref()?
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; routine suggestions stay off"
                );
            })
            .ok()
    }

    #[tracing::instrument(name = "routine.suggestions_flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<feature_flags::FlagSnapshot> {
        match self.flags(user).await {
            Some(flags) if flags.is_enabled(ROUTINE_SUGGESTIONS_FLAG) => Ok(flags),
            _ => bail!(ActionPolicyError::NotFound),
        }
    }

    /// The person's open routines session the request came from.
    async fn session(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<(MacroUserIdStr<'static>, GenerationSession, Vec<Surface>)> {
        let user = principal
            .owner()
            .as_user()
            .ok_or(ActionPolicyError::NotSuggesting)?
            .clone();
        let session = match correlation {
            Some(correlation) => self.request_sessions.session_of(correlation).await?,
            None => None,
        };
        let session = match session {
            Some(session) => self
                .generation_sessions
                .open_session(session)
                .await
                .map_err(|error| {
                    anyhow::anyhow!("could not read a generation session: {error:?}")
                })?,
            None => None,
        };
        let Some(session) =
            session.filter(|session| session.user == user && session.kind == SessionKind::Routines)
        else {
            bail!(ActionPolicyError::NotSuggesting);
        };
        let surfaces = session
            .surfaces
            .iter()
            .map(|name| {
                Ok(serde_json::from_value(serde_json::Value::String(
                    name.clone(),
                ))?)
            })
            .collect::<Result<Vec<Surface>>>()?;
        let span = tracing::Span::current();
        span.record("agent.session.id", session.session.to_string());
        if let Some(trace) = &session.trace_id {
            span.record("suggestion.generation.trace_id", trace.as_str());
        }
        Ok((user, session, surfaces))
    }

    /// The person's suggestions, per surface AI's then Macro's templates.
    async fn answer(
        &self,
        user: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> Result<RoutineSuggestions> {
        let (status, stored, dismissed_templates, saved_from) = tokio::try_join!(
            self.statuses.latest(user),
            self.repo.suggestions(user),
            self.repo.dismissed_templates(user),
            self.repo.saved_from(user),
        )?;
        Ok(RoutineSuggestions {
            status: status.unwrap_or(GenerationStatus::None),
            suggestions: fill(user, &stored, &dismissed_templates, &saved_from, surface),
        })
    }

    /// Check and keep one suggestion `session` handed back.
    async fn keep(
        &self,
        principal: &CreationPrincipal,
        user: &MacroUserIdStr<'static>,
        session: &GenerationSession,
        allowed: &[Surface],
        request: SuggestRequest,
    ) -> Result<SuggestOutcome> {
        let kept = self.repo.kept_by(user, session.session).await?;
        if kept >= MAX_KEPT_PER_SESSION {
            return Ok(rejected(vec![format!(
                "you suggested {MAX_KEPT_PER_SESSION} routines; that is enough, stop now"
            )]));
        }
        let (checked, check) = match request {
            SuggestRequest::Catalog {
                key,
                knobs,
                reason,
                surfaces,
                keep_probability,
            } => {
                let (stored, dismissed) = tokio::try_join!(
                    self.repo.suggestions(user),
                    self.repo.dismissed_templates(user),
                )?;
                // A retired pick may be suggested again; an open or
                // dismissed one may not.
                let taken = dismissed.contains(&key)
                    || stored.iter().any(|suggestion| {
                        suggestion.retired_at.is_none()
                            && matches!(&suggestion.pick, StoredPick::Catalog { key: taken, .. } if *taken == key)
                    });
                if taken {
                    return Ok(rejected(vec![format!(
                        "`{key}` was suggested already or dismissed; suggest something else"
                    )]));
                }
                (
                    decode::catalog_pick(&key, knobs, &reason, surfaces, keep_probability, allowed),
                    None,
                )
            }
            SuggestRequest::Routine {
                routine,
                created,
                reason,
                surfaces,
                keep_probability,
            } => {
                let check = self
                    .actions
                    .check_action(principal, routine, created, None)
                    .await?;
                if !check.ok {
                    return Ok(SuggestOutcome {
                        ok: false,
                        problems: check.problems.clone(),
                        check: Some(check),
                        id: None,
                    });
                }
                (
                    decode::drafted_pick(
                        check.routine.clone(),
                        &reason,
                        surfaces,
                        keep_probability,
                        allowed,
                    ),
                    Some(check),
                )
            }
        };
        match checked {
            Ok(checked) => {
                let id = self
                    .repo
                    .add(
                        user,
                        session.session,
                        session.generation,
                        &checked,
                        Utc::now(),
                    )
                    .await?;
                Ok(SuggestOutcome {
                    ok: true,
                    problems: Vec::new(),
                    check,
                    id: Some(id),
                })
            }
            Err(problems) => Ok(SuggestOutcome {
                ok: false,
                problems,
                check,
                id: None,
            }),
        }
    }

    /// Catalog keys and routine names the person was suggested or dismissed.
    async fn dismissed_names(&self, user: &MacroUserIdStr<'static>) -> Vec<String> {
        let (stored, templates) = tokio::join!(
            self.repo.suggestions(user),
            self.repo.dismissed_templates(user),
        );
        let mut names = templates.unwrap_or_default();
        names.extend(stored.unwrap_or_default().into_iter().map(
            |suggestion| match suggestion.pick {
                StoredPick::Catalog { key, .. } => key,
                StoredPick::Routine { routine } => routine.name,
            },
        ));
        names
    }
}

impl<Actions, Repo, Sources, Code, Flags> ports::RoutineSuggestionApi
    for RoutineSuggestionService<Actions, Repo, Sources, Code, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Code: RoutineCode,
    Flags: FeatureFlags + 'static,
{
    async fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> Result<RoutineSuggestions> {
        self.require_flag(user).await?;
        self.answer(user, surface).await
    }

    #[tracing::instrument(name = "routine.suggestions.brief", skip_all, fields(
        routine.suggestions.surfaces = ?surfaces,
        routine.suggestions.inbox_messages = tracing::field::Empty,
        routine.suggestions.apps = tracing::field::Empty,
        routine.suggestions.code = tracing::field::Empty,
    ), err)]
    async fn brief(
        &self,
        user: &MacroUserIdStr<'static>,
        surfaces: &[Surface],
        trigger: GenerationTrigger,
        timezone: Tz,
    ) -> Result<String> {
        let flags = self.require_flag(user).await?;
        let code = self.code.sdk().is_some() && flags.is_enabled(ROUTINE_CODE_STEPS_FLAG);
        let (inbox, apps, dismissed) = tokio::join!(
            self.sources.inbox(user, INBOX_MESSAGES),
            self.sources.apps(user),
            self.dismissed_names(user),
        );
        let inbox = inbox
            .inspect_err(|error| tracing::warn!(error = ?error, "could not read the inbox to suggest routines"))
            .unwrap_or_default();
        let apps = apps
            .inspect_err(|error| tracing::warn!(error = ?error, "could not read connected apps to suggest routines"))
            .unwrap_or_default();
        let span = tracing::Span::current();
        span.record("routine.suggestions.inbox_messages", inbox.len());
        span.record("routine.suggestions.apps", apps.len());
        span.record("routine.suggestions.code", code);
        Ok(prompt::brief(&prompt::BriefData {
            surfaces,
            trigger,
            inbox: &inbox,
            apps: &apps,
            dismissed: &dismissed,
            timezone: timezone.name(),
            agent_model: &self.briefing.agent_model,
            code,
            guide: self.briefing.guide,
        }))
    }

    async fn kept(&self, user: &MacroUserIdStr<'static>, session: Uuid) -> Result<u32> {
        self.repo.kept_by(user, session).await
    }

    async fn record(&self, user: &MacroUserIdStr<'static>, report: RoutineGenerationReport) {
        let stored = self.repo.suggestions(user).await.unwrap_or_default();
        // How long after the start the first of this generation's
        // suggestions was kept.
        let first_ms = stored
            .iter()
            .map(|suggestion| suggestion.created_at)
            .filter(|created| *created >= report.started_at)
            .min()
            .map(|first| (first - report.started_at).num_milliseconds().max(0) as u64);
        // Surfaces AI filled with at least one open suggestion; Macro's
        // templates fill the rest.
        let mut filled = 0;
        for surface in &ALL_SURFACES {
            let suggestions = stored
                .iter()
                .filter(|s| s.is_open() && s.surfaces.contains(surface))
                .count();
            filled += usize::from(suggestions > 0);
            // One per surface per generation, for per-surface fill rates.
            tracing::info!(
                event = "routine_suggestions.surface",
                trigger = report.trigger,
                outcome = report.outcome,
                surface = surface_name(*surface),
                filled = suggestions > 0,
                suggestions,
            );
        }
        tracing::info!(
            event = "routine_suggestions.generated",
            trigger = report.trigger,
            outcome = report.outcome,
            sessions = report.sessions,
            kept = report.kept,
            retries = report.retries,
            surfaces_filled = filled,
            first_ms,
            duration_ms = report.duration_ms,
        );
    }

    #[tracing::instrument(name = "routine.suggestions.review", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        routine.suggestions.count = tracing::field::Empty,
    ), err)]
    async fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<SuggestionReview> {
        let (user, session, _) = self.session(principal, correlation).await?;
        self.require_flag(&user).await?;
        let (stored, saved, kept) = tokio::try_join!(
            self.repo.suggestions(&user),
            self.repo.saved_from(&user),
            self.repo.kept_by(&user, session.session),
        )?;
        let saved: HashSet<Uuid> = saved.into_iter().collect();
        let suggestions: Vec<ReviewedSuggestion> = stored
            .iter()
            .map(|suggestion| {
                let (state, closed_at) = if saved.contains(&suggestion.id) {
                    (ReviewedState::Saved, None)
                } else if let Some(at) = suggestion.dismissed_at {
                    (ReviewedState::Dismissed, Some(at))
                } else if let Some(at) = suggestion.retired_at {
                    (ReviewedState::Retired, Some(at))
                } else {
                    (ReviewedState::Open, None)
                };
                let shown = for_you(suggestion, false);
                ReviewedSuggestion {
                    id: suggestion.id,
                    surfaces: suggestion.surfaces.clone(),
                    reason: suggestion.reason.clone(),
                    keep_probability: suggestion.keep_probability,
                    state,
                    created_at: suggestion.created_at,
                    closed_at,
                    pick: shown.pick,
                }
            })
            .collect();
        tracing::Span::current().record("routine.suggestions.count", suggestions.len());
        Ok(SuggestionReview {
            suggestions,
            kept_left: MAX_KEPT_PER_SESSION.saturating_sub(kept),
        })
    }

    #[tracing::instrument(name = "routine.suggestions.retire", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        routine.suggestion.id = %id,
        routine.suggestion.ok = tracing::field::Empty,
    ), err)]
    async fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireSuggestion,
    ) -> Result<SuggestOutcome> {
        let (user, session, _) = self.session(principal, correlation).await?;
        self.require_flag(&user).await?;
        let span = tracing::Span::current();
        let Some(reason) = shown_text::line(&request.reason, decode::MAX_REASON_CHARS) else {
            span.record("routine.suggestion.ok", false);
            return Ok(rejected(vec![format!(
                "the reason must be one plain line of at most {} characters",
                decode::MAX_REASON_CHARS
            )]));
        };
        if let Some(detail) = shown_text::personal_detail(&reason) {
            span.record("routine.suggestion.ok", false);
            return Ok(rejected(vec![format!(
                "the reason names {detail}; say why it no longer fits in general terms, \
                 without anyone's details"
            )]));
        }
        let saved = self.repo.saved_from(&user).await?;
        let retired = !saved.contains(&id)
            && self
                .repo
                .retire(
                    &user,
                    id,
                    session.session,
                    session.generation,
                    &reason,
                    Utc::now(),
                )
                .await?;
        span.record("routine.suggestion.ok", retired);
        if !retired {
            return Ok(rejected(vec![
                "only an open suggestion of the user's is retired; read them with `macro.routines.review()`"
                    .to_owned(),
            ]));
        }
        tracing::info!(event = "routine_suggestions.retired");
        Ok(SuggestOutcome {
            ok: true,
            problems: Vec::new(),
            check: None,
            id: Some(id),
        })
    }

    #[tracing::instrument(name = "routine.suggestions.dismiss", skip_all, fields(
        routine.suggestion.id = %id,
        routine.suggestion.from = tracing::field::Empty,
    ), err)]
    async fn dismiss(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        self.require_flag(user).await?;
        let span = tracing::Span::current();
        if self.repo.dismiss(user, id).await? {
            span.record("routine.suggestion.from", SuggestionFrom::ForYou.as_ref());
            let stored = self.repo.suggestions(user).await.unwrap_or_default();
            let origin = origin_of(&stored, user, id);
            tracing::info!(
                event = "routine_suggestions.dismissed",
                from = "for_you",
                kind = origin.map_or("unknown", |origin| origin.kind),
                surface = origin.and_then(|origin| origin.surface),
            );
            return Ok(());
        }
        let Some(routine) = CATALOG
            .iter()
            .find(|routine| template_id(user, routine.key) == id)
        else {
            bail!(ActionPolicyError::NotFound);
        };
        self.repo.dismiss_template(user, routine.key).await?;
        span.record("routine.suggestion.from", SuggestionFrom::Macro.as_ref());
        let origin = template_origin(routine.surfaces);
        tracing::info!(
            event = "routine_suggestions.dismissed",
            from = origin.from,
            kind = origin.kind,
            surface = origin.surface,
        );
        Ok(())
    }

    #[tracing::instrument(name = "routine.suggestions.suggest", skip_all, fields(
        routine.suggestion.kind = request.kind_name(),
        agent.session.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        routine.suggestion.ok = tracing::field::Empty,
        routine.suggestion.problems = tracing::field::Empty,
        routine.suggestion.id = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestRequest,
    ) -> Result<SuggestOutcome> {
        let span = tracing::Span::current();
        let (user, session, allowed) = self.session(principal, correlation).await?;
        self.require_flag(&user).await?;
        let kind = request.kind_name();
        let surface = match &request {
            SuggestRequest::Catalog { surfaces, .. } | SuggestRequest::Routine { surfaces, .. } => {
                surfaces.first().map(|surface| surface_name(*surface))
            }
        };
        let outcome = self
            .keep(principal, &user, &session, &allowed, request)
            .await?;
        span.record("routine.suggestion.ok", outcome.ok);
        span.record("routine.suggestion.problems", outcome.problems.len());
        if let Some(id) = outcome.id {
            span.record("routine.suggestion.id", id.to_string());
        }
        tracing::info!(
            event = "routine_suggestions.suggested",
            kind,
            surface,
            ok = outcome.ok,
            problems = outcome.problems.len(),
        );
        Ok(outcome)
    }
}

/// What suggestion `id`, made to `user`, was: one of AI's in `stored`, or
/// one of Macro's templates.
fn origin_of(
    stored: &[StoredSuggestion],
    user: &MacroUserIdStr<'_>,
    id: Uuid,
) -> Option<SuggestionOrigin> {
    if let Some(suggestion) = stored.iter().find(|suggestion| suggestion.id == id) {
        return Some(SuggestionOrigin {
            from: SuggestionFrom::ForYou.as_ref(),
            kind: match suggestion.pick {
                StoredPick::Catalog { .. } => "catalog",
                StoredPick::Routine { .. } => "routine",
            },
            surface: suggestion
                .surfaces
                .first()
                .map(|surface| surface_name(*surface)),
        });
    }
    CATALOG
        .iter()
        .find(|routine| template_id(user, routine.key) == id)
        .map(|routine| template_origin(routine.surfaces))
}

fn template_origin(surfaces: &[Surface]) -> SuggestionOrigin {
    SuggestionOrigin {
        from: SuggestionFrom::Macro.as_ref(),
        kind: "catalog",
        surface: surfaces.first().map(|surface| surface_name(*surface)),
    }
}

/// [`SuggestionOrigins`] from the stored suggestions and Macro's catalog.
pub struct StoredSuggestionOrigins<Repo>(pub Arc<Repo>);

#[async_trait::async_trait]
impl<Repo: SuggestionRepo> SuggestionOrigins for StoredSuggestionOrigins<Repo> {
    async fn origin(
        &self,
        owner: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<Option<SuggestionOrigin>> {
        let stored = self.0.suggestions(owner).await?;
        Ok(origin_of(&stored, owner, suggestion))
    }
}

/// A surface's wire name, for log fields.
fn surface_name(surface: Surface) -> &'static str {
    match surface {
        Surface::Email => "email",
        Surface::Calendar => "calendar",
        Surface::Tasks => "tasks",
        Surface::Files => "files",
        Surface::Crm => "crm",
        Surface::Chat => "chat",
        Surface::Calls => "calls",
        Surface::Reviews => "reviews",
        Surface::Agents => "agents",
    }
}

fn rejected(problems: Vec<String>) -> SuggestOutcome {
    SuggestOutcome {
        ok: false,
        problems,
        check: None,
        id: None,
    }
}

/// Per surface (only `surface`, when given), AI's open suggestions best
/// first, then catalog routines marked `suggest` as Macro's templates, to
/// [`PER_SURFACE`]. Skips what the person dismissed or saved a routine
/// from, and a template AI already picked. Each suggestion appears once,
/// in the order its first surface reached it.
pub fn fill(
    user: &MacroUserIdStr<'_>,
    stored: &[StoredSuggestion],
    dismissed_templates: &[String],
    saved_from: &[Uuid],
    surface: Option<Surface>,
) -> Vec<RoutineSuggestion> {
    let saved: HashSet<&Uuid> = saved_from.iter().collect();
    // Catalog keys AI picked (open, dismissed or saved) never show again as
    // Macro's templates.
    let picked: HashSet<&str> = stored
        .iter()
        .filter_map(|suggestion| match &suggestion.pick {
            StoredPick::Catalog { key, .. } => Some(key.as_str()),
            StoredPick::Routine { .. } => None,
        })
        .collect();
    let mut open: Vec<&StoredSuggestion> = stored
        .iter()
        .filter(|suggestion| suggestion.is_open() && !saved.contains(&suggestion.id))
        .collect();
    // Drafted routines first, then catalog picks, each best first; a second
    // one with the same catalog key or name is left out.
    open.sort_by(|a, b| {
        drafted(b)
            .cmp(&drafted(a))
            .then(b.keep_probability.total_cmp(&a.keep_probability))
    });
    let mut names: HashSet<String> = HashSet::new();
    open.retain(|suggestion| names.insert(suggestion_name(suggestion)));
    let on_by_default: HashSet<Uuid> = open
        .iter()
        .filter(|suggestion| match &suggestion.pick {
            StoredPick::Catalog { key, .. } => {
                suggestion.keep_probability >= ON_BY_DEFAULT_KEEP
                    && routine_program::catalog_routine(key)
                        .is_some_and(|routine| routine.safe_default && !routine.affects_others)
            }
            StoredPick::Routine { .. } => false,
        })
        .take(MAX_ON_BY_DEFAULT)
        .map(|suggestion| suggestion.id)
        .collect();
    let surfaces: Vec<Surface> = match surface {
        Some(surface) => vec![surface],
        None => ALL_SURFACES.to_vec(),
    };
    let mut shown: Vec<RoutineSuggestion> = Vec::new();
    let mut ids: HashSet<Uuid> = HashSet::new();
    for surface in surfaces {
        let mut count = shown
            .iter()
            .filter(|suggestion| suggestion.surfaces.contains(&surface))
            .count();
        for suggestion in open.iter().filter(|s| s.surfaces.contains(&surface)) {
            if count >= PER_SURFACE {
                break;
            }
            if ids.insert(suggestion.id) {
                shown.push(for_you(suggestion, on_by_default.contains(&suggestion.id)));
                count += 1;
            }
        }
        for routine in CATALOG.iter().filter(|routine| {
            routine.suggest
                && routine.surfaces.contains(&surface)
                && !picked.contains(routine.key)
                && !dismissed_templates.iter().any(|key| key == routine.key)
        }) {
            if count >= PER_SURFACE {
                break;
            }
            let id = template_id(user, routine.key);
            if saved.contains(&id) {
                continue;
            }
            if ids.insert(id) {
                shown.push(RoutineSuggestion {
                    id,
                    from: SuggestionFrom::Macro,
                    surfaces: routine.surfaces.to_vec(),
                    reason: None,
                    keep_probability: None,
                    on_by_default: false,
                    pick: SuggestedPick::Catalog {
                        key: routine.key.to_owned(),
                        knobs: serde_json::Map::new(),
                    },
                });
                count += 1;
            }
        }
    }
    shown
}

fn drafted(suggestion: &StoredSuggestion) -> bool {
    matches!(suggestion.pick, StoredPick::Routine { .. })
}

/// What two suggestions share when they are the same routine: a catalog
/// pick's title (its key names one title), a drafted routine's name.
fn suggestion_name(suggestion: &StoredSuggestion) -> String {
    match &suggestion.pick {
        StoredPick::Catalog { key, .. } => routine_program::catalog_routine(key)
            .map_or(key.as_str(), |routine| routine.title)
            .trim()
            .to_lowercase(),
        StoredPick::Routine { routine } => routine.name.trim().to_lowercase(),
    }
}

fn for_you(suggestion: &StoredSuggestion, on_by_default: bool) -> RoutineSuggestion {
    RoutineSuggestion {
        id: suggestion.id,
        from: SuggestionFrom::ForYou,
        surfaces: suggestion.surfaces.clone(),
        reason: Some(suggestion.reason.clone()),
        keep_probability: Some(suggestion.keep_probability),
        on_by_default,
        pick: match &suggestion.pick {
            StoredPick::Catalog { key, knobs } => SuggestedPick::Catalog {
                key: key.clone(),
                knobs: knobs.clone(),
            },
            StoredPick::Routine { routine } => SuggestedPick::Routine {
                routine: routine.clone(),
            },
        },
    }
}
