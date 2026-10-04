use async_graphql::{Enum, ID, SimpleObject, Union};
use rootcause::Report;
use scheduled_action::domain::{
    event_trigger::{ActionTrigger, EventName, RoutineTrigger},
    models::{ActionKind, AgentTask, ScheduledAction},
};
use serde_json::Value;

/// An AI routine owned by the authenticated user.
#[derive(SimpleObject)]
pub struct GraphqlScheduledAction {
    /// Stable identifier of the routine.
    id: ID,
    /// Name shown for the routine.
    name: String,
    /// Whether automatic dispatch runs this routine.
    enabled: bool,
    /// What starts a run of this routine.
    trigger: GraphqlScheduledActionTrigger,
    /// Agent task for this routine. Null when the stored task is not an agent task.
    agent_task: Option<GraphqlScheduledActionAgentTask>,
    /// When the current execution claim stops blocking configuration changes.
    /// The timestamp stays present after that instant so clients can compare it themselves.
    claim_expires_at: Option<String>,
    /// When the routine was created, as RFC 3339.
    created_at: String,
    /// When the routine row last changed, including execution bookkeeping, as RFC 3339.
    updated_at: String,
}

/// The way a routine starts.
#[derive(Union)]
pub(crate) enum GraphqlScheduledActionTrigger {
    Cron(GraphqlScheduledActionCronTrigger),
    Events(GraphqlScheduledActionEventsTrigger),
    Multiple(GraphqlScheduledActionMultipleTrigger),
}

/// A routine that runs on a cron schedule.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionCronTrigger {
    /// Cron expression in the six- or seven-field format the scheduler accepts.
    schedule: String,
    /// Time zone name the cron expression is evaluated in.
    timezone: String,
    /// Next cron firing, as RFC 3339. Null when the routine is disabled.
    next_run_at: Option<String>,
}

/// Any of several schedules and optional Macro event filters.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionMultipleTrigger {
    /// Each schedule retains its own timezone and next firing.
    schedules: Vec<GraphqlScheduledActionCronTrigger>,
    /// Events that can also trigger this routine.
    events: Option<GraphqlScheduledActionEventsTrigger>,
}

/// A routine that runs when matching events are published.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionEventsTrigger {
    /// Event filters. A run starts when any filter matches.
    filters: Vec<GraphqlScheduledActionEventFilter>,
}

/// One event filter. The event name and entity id must both match.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionEventFilter {
    /// Event names that can satisfy this filter.
    events: Vec<GraphqlScheduledActionEventName>,
    /// Entity ids that can satisfy this filter. Null matches every id; an empty list matches nothing.
    entity_ids: Option<Vec<ID>>,
}

/// The agent task a routine runs.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionAgentTask {
    /// Model the task runs. Null when the selected agent uses its default model.
    model: Option<String>,
    /// Selected agent. Null for model-only tasks.
    agent: Option<GraphqlScheduledActionAgent>,
    /// System prompt for the agent.
    prompt: String,
    /// User prompt for the agent.
    user_prompt: String,
}

/// An agent selected to run a routine.
#[derive(SimpleObject)]
pub(crate) struct GraphqlScheduledActionAgent {
    /// Stable identifier of the selected agent.
    bot_id: ID,
}

/// Events a routine filter can name.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub(crate) enum GraphqlScheduledActionEventName {
    /// A document was created.
    DocumentCreated,
    /// A document was updated.
    DocumentUpdated,
    /// A channel was created.
    ChannelCreated,
    /// A channel message was posted.
    ChannelMessagePosted,
    /// A user was mentioned in a channel.
    ChannelMentioned,
    /// A channel message was patched.
    ChannelMessagePatched,
    /// A channel message attachment was created.
    ChannelMessageAttachmentCreated,
}

impl From<EventName> for GraphqlScheduledActionEventName {
    fn from(name: EventName) -> Self {
        match name {
            EventName::DocumentCreated => Self::DocumentCreated,
            EventName::DocumentUpdated => Self::DocumentUpdated,
            EventName::ChannelCreated => Self::ChannelCreated,
            EventName::ChannelMessagePosted => Self::ChannelMessagePosted,
            EventName::ChannelMentioned => Self::ChannelMentioned,
            EventName::ChannelMessagePatched => Self::ChannelMessagePatched,
            EventName::ChannelMessageAttachmentCreated => Self::ChannelMessageAttachmentCreated,
        }
    }
}

pub(crate) fn scheduled_action(action: ScheduledAction) -> Result<GraphqlScheduledAction, Report> {
    let Some(id) = action.id else {
        return Err(rootcause::report!(
            "listed scheduled action is missing an id"
        ));
    };
    let trigger = trigger(&action);
    let agent_task = agent_task(&action.kind, &action.task);
    let claim_expires_at = action.claim_expires_at().map(|at| at.to_rfc3339());
    let created_at = action.created_at.to_rfc3339();
    let updated_at = action.updated_at.to_rfc3339();
    Ok(GraphqlScheduledAction {
        id: ID(id.to_string()),
        name: action.name,
        enabled: action.enabled,
        trigger,
        agent_task,
        claim_expires_at,
        created_at,
        updated_at,
    })
}

fn trigger(action: &ScheduledAction) -> GraphqlScheduledActionTrigger {
    match &action.trigger {
        ActionTrigger::Cron { schedule, timezone } => {
            let next_run_at = if action.enabled {
                action.next_run_at.map(|at| at.to_rfc3339())
            } else {
                None
            };
            GraphqlScheduledActionTrigger::Cron(GraphqlScheduledActionCronTrigger {
                schedule: schedule.as_str().to_owned(),
                timezone: timezone.to_string(),
                next_run_at,
            })
        }
        ActionTrigger::Multiple { triggers } => {
            GraphqlScheduledActionTrigger::Multiple(GraphqlScheduledActionMultipleTrigger {
                schedules: triggers
                    .as_slice()
                    .iter()
                    .filter_map(|trigger| match trigger {
                        RoutineTrigger::Cron { schedule, timezone } => {
                            Some(GraphqlScheduledActionCronTrigger {
                                schedule: schedule.as_str().to_owned(),
                                timezone: timezone.to_string(),
                                next_run_at: action
                                    .enabled
                                    .then(|| {
                                        schedule
                                            .next_run_after_now(*timezone)
                                            .map(|at| at.to_rfc3339())
                                    })
                                    .flatten(),
                            })
                        }
                        RoutineTrigger::Events { .. } => None,
                    })
                    .collect(),
                events: action.trigger.event_filters().map(event_filters),
            })
        }
        ActionTrigger::Events { filters } => {
            GraphqlScheduledActionTrigger::Events(event_filters(filters))
        }
    }
}

fn agent_task(kind: &ActionKind, task: &Value) -> Option<GraphqlScheduledActionAgentTask> {
    match kind {
        ActionKind::Agent => {
            let task = serde_json::from_value::<AgentTask>(task.clone()).ok()?;
            task.resolve_target().ok()?;
            Some(GraphqlScheduledActionAgentTask {
                model: task.model.map(|model| model.as_str().to_owned()),
                agent: task.agent.map(|agent| GraphqlScheduledActionAgent {
                    bot_id: ID(agent.bot_id.to_string()),
                }),
                prompt: task.prompt,
                user_prompt: task.user_prompt,
            })
        }
    }
}

fn event_filters(
    filters: &scheduled_action::domain::event_trigger::EventFilters,
) -> GraphqlScheduledActionEventsTrigger {
    GraphqlScheduledActionEventsTrigger {
        filters: filters
            .as_slice()
            .iter()
            .map(|filter| GraphqlScheduledActionEventFilter {
                events: filter.events().iter().copied().map(Into::into).collect(),
                entity_ids: filter
                    .ids()
                    .map(|ids| ids.iter().map(|id| ID(id.to_string())).collect()),
            })
            .collect(),
    }
}
