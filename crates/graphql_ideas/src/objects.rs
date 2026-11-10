use async_graphql::{Enum, ID, SimpleObject, Union};
use chrono::{DateTime, Utc};
use graphql_common::GraphqlEntityType;
use ideas::domain::model::{
    Category, EntityAction, Idea, IdeaKind, IdeaRun, IdeaState, Ideas, RunMode, RunProgress, Target,
};

/// The authenticated user's ideas.
#[derive(SimpleObject)]
pub struct GraphqlIdeaFeed {
    /// The ideas, best first.
    ideas: Vec<GraphqlIdea>,
}

impl From<Ideas> for GraphqlIdeaFeed {
    fn from(feed: Ideas) -> Self {
        Self {
            ideas: feed.ideas.into_iter().map(Into::into).collect(),
        }
    }
}

/// One proactive suggestion for the authenticated user.
#[derive(SimpleObject)]
pub struct GraphqlIdea {
    /// The idea's id.
    id: ID,
    /// What to do, in a few words.
    title: String,
    /// Why, in a line or two.
    summary: String,
    /// 0 to 100, for ordering.
    importance: u8,
    /// The feed's filters it shows under.
    categories: Vec<GraphqlIdeaCategory>,
    /// Where it is for the user.
    state: GraphqlIdeaState,
    /// Why it was resolved; only on resolved ideas.
    state_reason: Option<String>,
    /// The items it is about.
    about: Vec<GraphqlIdeaTarget>,
    /// What acting on it produced.
    produced: Vec<GraphqlIdeaTarget>,
    /// When it was first proposed.
    created_at: DateTime<Utc>,
    /// When it last changed.
    updated_at: DateTime<Utc>,
    /// When its state last changed.
    state_changed_at: DateTime<Utc>,
    /// A background prompt idea's latest run.
    run: Option<GraphqlIdeaRun>,
    /// Its kind, with that kind's data. A kind never changes.
    kind: GraphqlIdeaKind,
}

impl From<Idea> for GraphqlIdea {
    fn from(idea: Idea) -> Self {
        Self {
            id: ID(idea.id.to_string()),
            title: idea.title,
            summary: idea.summary,
            importance: idea.importance,
            categories: idea.categories.into_iter().map(Into::into).collect(),
            state: idea.state.into(),
            state_reason: idea.state_reason,
            about: idea.about.into_iter().map(Into::into).collect(),
            produced: idea.produced.into_iter().map(Into::into).collect(),
            created_at: idea.created_at,
            updated_at: idea.updated_at,
            state_changed_at: idea.state_changed_at,
            run: idea.run.map(Into::into),
            kind: idea.kind.into(),
        }
    }
}

/// What kind of idea it is.
#[derive(Union)]
pub enum GraphqlIdeaKind {
    /// A prompt for an agent.
    Prompt(GraphqlPromptIdea),
    /// A note about specific items.
    Entity(GraphqlEntityIdea),
    /// A routine suggestion, shown among ideas.
    Routine(GraphqlRoutineIdea),
}

impl From<IdeaKind> for GraphqlIdeaKind {
    fn from(kind: IdeaKind) -> Self {
        match kind {
            IdeaKind::Prompt { prompt, run_mode } => Self::Prompt(GraphqlPromptIdea {
                prompt,
                run_mode: run_mode.into(),
            }),
            IdeaKind::Entity { action, draft } => Self::Entity(GraphqlEntityIdea {
                action: action.into(),
                draft: draft.map(Into::into),
            }),
            IdeaKind::Routine {
                routine_suggestion_id,
            } => Self::Routine(GraphqlRoutineIdea {
                routine_suggestion_id: ID(routine_suggestion_id.to_string()),
            }),
        }
    }
}

/// A prompt for an agent: opened in the composer, or run in the background.
#[derive(SimpleObject)]
pub struct GraphqlPromptIdea {
    /// What the agent is asked to do.
    prompt: String,
    /// How it runs.
    run_mode: GraphqlIdeaRunMode,
}

/// A note about specific items, with what to do about them.
#[derive(SimpleObject)]
pub struct GraphqlEntityIdea {
    /// What to do about the items.
    action: GraphqlIdeaEntityAction,
    /// A reply idea's draft, once a session wrote one: the email thread it
    /// is in, with the draft as the part.
    draft: Option<GraphqlIdeaTarget>,
}

/// A routine suggestion, shown among ideas.
#[derive(SimpleObject)]
pub struct GraphqlRoutineIdea {
    /// The routine suggestion it shows, as `routineSuggestions` lists it.
    routine_suggestion_id: ID,
}

/// An item, or a part of one such as a message in a thread.
#[derive(SimpleObject)]
pub struct GraphqlIdeaTarget {
    /// The item's type.
    entity_type: GraphqlEntityType,
    /// The item's id.
    entity_id: String,
    /// A part of it, such as one message in a channel.
    part_id: Option<String>,
}

impl From<Target> for GraphqlIdeaTarget {
    fn from(target: Target) -> Self {
        Self {
            entity_type: GraphqlEntityType::new(target.entity_type),
            entity_id: target.entity_id,
            part_id: target.part_id,
        }
    }
}

/// A run of a background prompt idea: a hidden agent session of the user's.
#[derive(SimpleObject)]
pub struct GraphqlIdeaRun {
    /// The agent session: open it to see the result or answer what it
    /// waits for.
    session_id: ID,
    /// When it started.
    started_at: DateTime<Utc>,
    /// How it is going, read from the session.
    progress: GraphqlIdeaRunProgress,
}

impl From<IdeaRun> for GraphqlIdeaRun {
    fn from(run: IdeaRun) -> Self {
        Self {
            session_id: ID(run.session_id.to_string()),
            started_at: run.started_at,
            progress: run.progress.into(),
        }
    }
}

/// Where an idea is for the user.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "IdeaState")]
pub enum GraphqlIdeaState {
    /// Shown, not acted on yet.
    Proposed,
    /// The user acted on it, and it is under way.
    Accepted,
    /// Finished: what it suggested was done.
    Done,
    /// The user isn't interested.
    Dismissed,
    /// Something happened that ended it, such as the email being answered.
    Resolved,
    /// A generation session found it no longer matters.
    Retired,
}

/// A filter on the feed. Not kinds: an idea may have several.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "Category")]
pub enum GraphqlIdeaCategory {
    /// Matters now.
    Important,
    /// Worth coming back to.
    Revisit,
    /// Saves money.
    SaveMoney,
    /// Makes money.
    MakeMoney,
}

/// How a prompt idea runs.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "RunMode")]
pub enum GraphqlIdeaRunMode {
    /// Opened in the composer, prefilled, for the user to send.
    Composer,
    /// Run in a hidden session; the user sees the result.
    Background,
}

/// What an entity idea suggests doing about its items.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "EntityAction")]
pub enum GraphqlIdeaEntityAction {
    /// Answer it.
    Reply,
    /// Look at it.
    Review,
    /// Chase it up.
    FollowUp,
}

/// How a run is going, as its session says.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
#[graphql(remote = "RunProgress")]
pub enum GraphqlIdeaRunProgress {
    /// Working.
    Running,
    /// Waiting for the user to approve a tool call.
    NeedsApproval,
    /// Waiting for the user to answer a question.
    NeedsInput,
    /// Done; its result is in the session and the idea's `produced`.
    Finished,
    /// It stopped without finishing; accepting the idea again retries.
    Failed,
    /// The session couldn't be read just now.
    Unknown,
}
