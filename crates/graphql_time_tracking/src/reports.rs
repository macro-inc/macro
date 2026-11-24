//! Reports over logged time for the web: totals for a project, the viewer or
//! the viewer's team over a period, grouped by person, task or day.

use std::{future::Future, marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ID, InputObject, Object};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use graphql_soup::{GraphqlSoupDocument, SoupEntityEdges};
use macro_user_id::user_id::MacroUserIdStr;
use time_tracking::domain::{
    report::{
        TimeBreakdown, TimeGroup, TimeGroupKey, TimeGrouping, TimePeriod, TimeScope, TimeSummary,
        TimeTotal,
    },
    report_service::TimeReportService,
};
use uuid::Uuid;

use crate::{
    access_error, bad_input, coded, context::TimeTrackingFailure, domain_error, inputs::parse_date,
    objects::load_task,
};

/// Whose time a report reads.
#[derive(Enum, Copy, Clone, Debug, PartialEq, Eq)]
#[graphql(name = "TimeReportScope")]
pub enum GraphqlTimeReportScope {
    /// Everyone's time on a project's tasks; needs `projectId`.
    Project,
    /// The viewer's own time.
    Mine,
    /// The time of the viewer's team's current members, the viewer included.
    Team,
}

/// What a report's totals are grouped by.
#[derive(Enum, Copy, Clone, Debug, PartialEq, Eq)]
#[graphql(name = "TimeGrouping")]
pub enum GraphqlTimeGrouping {
    /// The person who logged the time.
    Person,
    /// The task the time was logged on.
    Task,
    /// The logger's calendar day.
    Day,
}

impl From<GraphqlTimeGrouping> for TimeGrouping {
    fn from(grouping: GraphqlTimeGrouping) -> Self {
        match grouping {
            GraphqlTimeGrouping::Person => Self::Person,
            GraphqlTimeGrouping::Task => Self::Task,
            GraphqlTimeGrouping::Day => Self::Day,
        }
    }
}

/// The scope, days and grouping of a time summary.
#[derive(InputObject, Clone, Debug)]
pub struct TimeSummaryInput {
    /// Whose time to read.
    pub scope: GraphqlTimeReportScope,
    /// The project, with scope `PROJECT` only.
    pub project_id: Option<ID>,
    /// The first day, `YYYY-MM-DD`.
    pub from: String,
    /// The last day, `YYYY-MM-DD`, at most 365 days after `from`.
    pub to: String,
    /// What the totals are grouped by.
    pub group_by: GraphqlTimeGrouping,
    /// What each group is split by; another grouping than `groupBy`.
    pub then_by: Option<GraphqlTimeGrouping>,
}

/// The scope of a request before the project's access check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScopeRequest {
    Project(Uuid),
    Mine,
    Team,
}

/// A validated summary request.
pub(crate) struct SummaryRequest {
    pub(crate) scope: ScopeRequest,
    pub(crate) period: TimePeriod,
    pub(crate) breakdown: TimeBreakdown,
}

impl TimeSummaryInput {
    fn parse(self) -> async_graphql::Result<SummaryRequest> {
        let scope = match (self.scope, self.project_id) {
            (GraphqlTimeReportScope::Project, Some(project_id)) => ScopeRequest::Project(
                Uuid::parse_str(&project_id)
                    .map_err(|_| bad_input("projectId must be a project id"))?,
            ),
            (GraphqlTimeReportScope::Project, None) => {
                return Err(bad_input("a project report needs projectId"));
            }
            (GraphqlTimeReportScope::Mine | GraphqlTimeReportScope::Team, Some(_)) => {
                return Err(bad_input("projectId goes with scope PROJECT only"));
            }
            (GraphqlTimeReportScope::Mine, None) => ScopeRequest::Mine,
            (GraphqlTimeReportScope::Team, None) => ScopeRequest::Team,
        };
        let period = TimePeriod::new(parse_date(&self.from, "from")?, parse_date(&self.to, "to")?)
            .map_err(domain_error)?;
        let breakdown = TimeBreakdown::new(self.group_by.into(), self.then_by.map(Into::into))
            .map_err(domain_error)?;
        Ok(SummaryRequest {
            scope,
            period,
            breakdown,
        })
    }
}

/// Object-safe forwarding future for the request's concrete report service.
type ReportFuture<'a, T> =
    std::pin::Pin<Box<dyn Future<Output = Result<T, TimeTrackingFailure>> + Send + 'a>>;

/// Transport-facing report capability; mints the project receipt and delegates.
pub(crate) trait TimeReportApi: Send + Sync {
    fn summary(
        &self,
        user: MacroUserIdStr<'static>,
        request: SummaryRequest,
    ) -> ReportFuture<'_, TimeSummary>;
}

/// Request-scoped report capability.
///
/// Type erasure keeps domain implementation parameters out of the schema's public type.
#[derive(Clone)]
pub struct TimeReportGraphqlContext(pub(crate) Arc<dyn TimeReportApi>);

/// Typed capability-minting boundary for the project a report names.
pub trait TimeReportAuthorizer: Send + Sync + 'static {
    /// Verify the viewer may view the project.
    fn authorize_project(
        &self,
        user: &MacroUserIdStr<'static>,
        project_id: Uuid,
    ) -> impl Future<Output = Result<EntityAccessReceipt<ViewAccessLevel>, AccessError>> + Send;
}

impl<A: EntityAccessService> TimeReportAuthorizer for A {
    async fn authorize_project(
        &self,
        user: &MacroUserIdStr<'static>,
        project_id: Uuid,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, AccessError> {
        self.generate_entity_access_receipt::<ViewAccessLevel>(
            user,
            None,
            &project_id.to_string(),
            EntityType::Initiative,
        )
        .await
    }
}

impl TimeReportGraphqlContext {
    /// Compose the report use cases and the project receipt boundary.
    pub fn new<R: TimeReportService, A: TimeReportAuthorizer>(
        reports: Arc<R>,
        access: Arc<A>,
    ) -> Self {
        Self(Arc::new(TimeReportApiAdapter { reports, access }))
    }
}

struct TimeReportApiAdapter<R, A> {
    reports: Arc<R>,
    access: Arc<A>,
}

impl<R: TimeReportService, A: TimeReportAuthorizer> TimeReportApi for TimeReportApiAdapter<R, A> {
    fn summary(
        &self,
        user: MacroUserIdStr<'static>,
        request: SummaryRequest,
    ) -> ReportFuture<'_, TimeSummary> {
        Box::pin(async move {
            let scope = match request.scope {
                ScopeRequest::Project(project_id) => {
                    TimeScope::Project(self.access.authorize_project(&user, project_id).await?)
                }
                ScopeRequest::Mine => TimeScope::Mine,
                ScopeRequest::Team => TimeScope::Team,
            };
            Ok(self
                .reports
                .summary(&user, scope, request.period, request.breakdown)
                .await?)
        })
    }
}

/// A refused project reads as the project, not as a task.
fn report_error(failure: TimeTrackingFailure) -> async_graphql::Error {
    match failure {
        TimeTrackingFailure::Access(
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        ) => coded("you do not have access to this project", "FORBIDDEN"),
        TimeTrackingFailure::Access(AccessError::NotFound(_)) => {
            coded("project not found", "NOT_FOUND")
        }
        TimeTrackingFailure::Access(error) => access_error(error),
        TimeTrackingFailure::Domain(error) => domain_error(error),
    }
}

/// The viewer's time summary for a project, themselves or their team.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_time_summary<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    input: TimeSummaryInput,
) -> async_graphql::Result<GraphqlTimeSummary<E>> {
    let request = input.parse()?;
    let summary = ctx
        .data::<TimeReportGraphqlContext>()?
        .0
        .summary(user_id.clone(), request)
        .await
        .map_err(report_error)?;
    Ok(GraphqlTimeSummary {
        summary,
        _edges: PhantomData,
    })
}

/// What one total is for: a person, a task or a day.
pub struct GraphqlTimeGroupKey<E> {
    key: TimeGroupKey,
    _edges: PhantomData<fn() -> E>,
}

/// What one total is for: a person, a task or a day.
#[Object(name = "GraphqlTimeGroupKey")]
impl<E: SoupEntityEdges> GraphqlTimeGroupKey<E> {
    /// Which of the fields below is set.
    async fn by(&self) -> GraphqlTimeGrouping {
        match self.key {
            TimeGroupKey::Person { .. } => GraphqlTimeGrouping::Person,
            TimeGroupKey::Task { .. } => GraphqlTimeGrouping::Task,
            TimeGroupKey::Day { .. } => GraphqlTimeGrouping::Day,
        }
    }

    /// The person, for `PERSON`.
    async fn user_id(&self) -> Option<&str> {
        match &self.key {
            TimeGroupKey::Person { user_id } => Some(user_id.as_ref()),
            _ => None,
        }
    }

    /// The task document, for `TASK`.
    async fn task_id(&self) -> Option<ID> {
        match &self.key {
            TimeGroupKey::Task { task_id } => Some(ID(task_id.clone())),
            _ => None,
        }
    }

    /// The task, for `TASK`; null when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        match &self.key {
            TimeGroupKey::Task { task_id } => load_task(ctx, task_id).await,
            _ => Ok(None),
        }
    }

    /// The loggers' calendar day, `YYYY-MM-DD`, for `DAY`.
    async fn date(&self) -> Option<String> {
        match &self.key {
            TimeGroupKey::Day { date } => Some(date.to_string()),
            _ => None,
        }
    }
}

fn key<E>(key: &TimeGroupKey) -> GraphqlTimeGroupKey<E> {
    GraphqlTimeGroupKey {
        key: key.clone(),
        _edges: PhantomData,
    }
}

/// A total of minutes.
pub struct GraphqlTimeTotal<E> {
    total: TimeTotal,
    _edges: PhantomData<fn() -> E>,
}

/// A total of minutes.
#[Object(name = "GraphqlTimeTotal")]
impl<E: SoupEntityEdges> GraphqlTimeTotal<E> {
    /// What the total is for.
    async fn key(&self) -> GraphqlTimeGroupKey<E> {
        key(&self.total.key)
    }

    /// Minutes logged.
    async fn minutes(&self) -> u32 {
        self.total.minutes
    }
}

fn totals<E>(totals: &[TimeTotal]) -> Vec<GraphqlTimeTotal<E>> {
    totals
        .iter()
        .map(|total| GraphqlTimeTotal {
            total: total.clone(),
            _edges: PhantomData,
        })
        .collect()
}

/// One group's total and its split by the second grouping.
pub struct GraphqlTimeGroup<E> {
    group: TimeGroup,
    _edges: PhantomData<fn() -> E>,
}

/// One group's total and its split by the second grouping.
#[Object(name = "GraphqlTimeGroup")]
impl<E: SoupEntityEdges> GraphqlTimeGroup<E> {
    /// What the group is for.
    async fn key(&self) -> GraphqlTimeGroupKey<E> {
        key(&self.group.key)
    }

    /// Minutes logged in the group.
    async fn minutes(&self) -> u32 {
        self.group.minutes
    }

    /// Tasks with time in the group.
    async fn task_count(&self) -> u32 {
        self.group.task_count
    }

    /// The group's totals by the second grouping, in report order; empty
    /// without one.
    async fn rows(&self) -> Vec<GraphqlTimeTotal<E>> {
        totals(&self.group.rows)
    }
}

/// The time a scope logged over a period.
pub struct GraphqlTimeSummary<E> {
    summary: TimeSummary,
    _edges: PhantomData<fn() -> E>,
}

/// The time a scope logged over a period. Only tasks the viewer can see
/// count, out of the Trash.
#[Object(name = "GraphqlTimeSummary")]
impl<E: SoupEntityEdges> GraphqlTimeSummary<E> {
    /// The first day of the period, `YYYY-MM-DD`.
    async fn from(&self) -> String {
        self.summary.from.to_string()
    }

    /// The last day of the period, `YYYY-MM-DD`.
    async fn to(&self) -> String {
        self.summary.to.to_string()
    }

    /// Minutes logged in the period.
    async fn total_minutes(&self) -> u32 {
        self.summary.total_minutes
    }

    /// Tasks with time in the period.
    async fn task_count(&self) -> u32 {
        self.summary.task_count
    }

    /// For a project, its tasks the viewer can see that are out of the
    /// Trash, with time or not; null for other scopes.
    async fn scope_task_count(&self) -> Option<u32> {
        self.summary.scope_task_count
    }

    /// False when the scope held more than 5,000 tasks and only the first
    /// 5,000 were read.
    async fn complete(&self) -> bool {
        self.summary.complete
    }

    /// Totals by the first grouping: days in calendar order, people and
    /// tasks with the most time first. Grouped by person, the viewer's own
    /// and their team's summaries list every current member.
    async fn groups(&self) -> Vec<GraphqlTimeGroup<E>> {
        self.summary
            .groups
            .iter()
            .map(|group| GraphqlTimeGroup {
                group: group.clone(),
                _edges: PhantomData,
            })
            .collect()
    }

    /// Totals by the second grouping across all groups; empty without one.
    async fn then_totals(&self) -> Vec<GraphqlTimeTotal<E>> {
        totals(&self.summary.then_totals)
    }
}
