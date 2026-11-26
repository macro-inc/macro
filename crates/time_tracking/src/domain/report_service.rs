//! Reports over logged time: who sees which totals, and how each scope is
//! bounded before its entries are read.
//!
//! - A project's report needs view access to the project, and counts only
//!   the project's tasks the caller can see.
//! - The caller's own and their team's reports count only tasks the caller
//!   can see; time teammates logged elsewhere is left out of rows and totals.
//! - Every scope reads at most [`MAX_SCOPE_TASKS`] tasks and says when it
//!   stopped there. Access is checked once, for all of them together.
//! - Reports are open while the rollout is off, as a task's entry list is:
//!   they hold nothing until someone logs time.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::{models::EntityType, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use tracing::{Level, field::Empty};
use uuid::Uuid;

use crate::domain::{
    models::TimeTrackingError,
    ports::{ProjectTasks, ReportFilter, ReportRead, TimeReportRepository},
    report::{
        MAX_EXPORT_ROWS, MAX_SCOPE_TASKS, ReportTask, TimeBreakdown, TimeExport, TimePeriod,
        TimeScope, TimeSummary, assemble_summary, encode_export,
    },
};

/// The report use cases, called by the HTTP and GraphQL adapters.
pub trait TimeReportService: Send + Sync + 'static {
    /// The scope's time over the period, grouped as the breakdown says. Reads
    /// the latest writes, since a report is read again after each change.
    fn summary(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
        breakdown: TimeBreakdown,
    ) -> impl Future<Output = Result<TimeSummary, TimeTrackingError>> + Send;

    /// The scope's entries over the period as CSV. May miss the last few
    /// seconds of writes.
    fn export(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
    ) -> impl Future<Output = Result<TimeExport, TimeTrackingError>> + Send;
}

/// The report service over its repository, the entity access service and a
/// project's task list.
pub struct TimeReportServiceImpl<R, A, P> {
    repo: R,
    access: Arc<A>,
    projects: P,
}

impl<R, A, P> TimeReportServiceImpl<R, A, P> {
    /// Compose the service.
    pub fn new(repo: R, access: Arc<A>, projects: P) -> Self {
        Self {
            repo,
            access,
            projects,
        }
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> TimeTrackingError {
    TimeTrackingError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// A scope after its tasks were found and checked.
struct ResolvedScope {
    /// Live tasks the caller can see, in id order.
    tasks: Vec<ReportTask>,
    /// Their ids.
    task_ids: Vec<String>,
    /// Only these people's entries count; everyone's when absent.
    people: Option<Vec<MacroUserIdStr<'static>>>,
    /// For a project: it is the scope, so its visible tasks are counted.
    project: bool,
    /// Whether every task of the scope was read.
    complete: bool,
}

impl<R, A, P> TimeReportServiceImpl<R, A, P>
where
    R: TimeReportRepository,
    A: EntityAccessService,
    P: ProjectTasks,
{
    /// Find the scope's tasks, at most [`MAX_SCOPE_TASKS`], and keep those the
    /// caller can see.
    async fn resolve(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: &TimeScope,
        period: TimePeriod,
        read: ReportRead,
    ) -> Result<ResolvedScope, TimeTrackingError> {
        let span = tracing::Span::current();
        let (mut task_ids, people) = match scope {
            TimeScope::Project(receipt) => {
                let entity = receipt.entity();
                let same_caller = receipt
                    .get_authenticated_user()
                    .is_ok_and(|caller| caller.as_ref() == user_id.as_ref());
                if entity.entity_type != EntityType::Initiative || !same_caller {
                    return Err(TimeTrackingError::NotFound("project"));
                }
                let project_id = Uuid::parse_str(&entity.entity_id)
                    .map_err(|_| TimeTrackingError::NotFound("project"))?;
                span.record("project_id", tracing::field::display(project_id));
                let task_ids = self
                    .projects
                    .project_task_ids(project_id, MAX_SCOPE_TASKS + 1)
                    .await
                    .map_err(internal)?;
                (task_ids, None)
            }
            TimeScope::Mine | TimeScope::Team => {
                let people = match scope {
                    TimeScope::Team => self
                        .repo
                        .team_members(user_id, read)
                        .await
                        .map_err(internal)?,
                    _ => vec![user_id.clone()],
                };
                span.record("people", people.len());
                let task_ids = self
                    .repo
                    .people_task_ids(&people, period, MAX_SCOPE_TASKS + 1, read)
                    .await
                    .map_err(internal)?;
                (task_ids, Some(people))
            }
        };

        let complete = task_ids.len() <= usize::from(MAX_SCOPE_TASKS);
        task_ids.truncate(usize::from(MAX_SCOPE_TASKS));
        span.record("scope_tasks", task_ids.len());
        span.record("scope_complete", complete);

        if task_ids.is_empty() {
            span.record("visible_tasks", 0);
            return Ok(ResolvedScope {
                tasks: Vec::new(),
                task_ids,
                people,
                project: matches!(scope, TimeScope::Project(_)),
                complete,
            });
        }
        let mut visible: Vec<String> = self
            .access
            .generate_document_view_access_receipts(user_id, &task_ids)
            .await
            .map_err(internal)?
            .into_keys()
            .collect();
        visible.sort_unstable();
        span.record("visible_tasks", visible.len());
        // The access check keeps trashed documents; reports leave them out.
        let tasks = if visible.is_empty() {
            Vec::new()
        } else {
            self.repo
                .live_tasks(&visible, read)
                .await
                .map_err(internal)?
        };

        Ok(ResolvedScope {
            task_ids: tasks.iter().map(|task| task.id.clone()).collect(),
            tasks,
            people,
            project: matches!(scope, TimeScope::Project(_)),
            complete,
        })
    }
}

impl<R, A, P> TimeReportService for TimeReportServiceImpl<R, A, P>
where
    R: TimeReportRepository,
    A: EntityAccessService,
    P: ProjectTasks,
{
    #[tracing::instrument(
        name = "time.summary",
        skip_all,
        fields(
            scope = scope.name(),
            project_id = Empty,
            from = %period.from(),
            to = %period.to(),
            group_by = ?breakdown.group_by(),
            then_by = ?breakdown.then_by(),
            people = Empty,
            scope_tasks = Empty,
            visible_tasks = Empty,
            scope_complete = Empty,
            groups = Empty,
        ),
        err(level = Level::INFO)
    )]
    async fn summary(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
        breakdown: TimeBreakdown,
    ) -> Result<TimeSummary, TimeTrackingError> {
        let read = ReportRead::Latest;
        let resolved = self.resolve(user_id, &scope, period, read).await?;

        let sums = if resolved.task_ids.is_empty() {
            Vec::new()
        } else {
            self.repo
                .summary_sums(
                    ReportFilter {
                        task_ids: &resolved.task_ids,
                        people: resolved.people.as_deref(),
                        period,
                    },
                    breakdown,
                    read,
                )
                .await
                .map_err(internal)?
        };
        let scope_task_count = resolved
            .project
            .then(|| u32::try_from(resolved.task_ids.len()).unwrap_or(u32::MAX));

        let summary = assemble_summary(
            period,
            breakdown,
            sums,
            resolved.people.as_deref(),
            scope_task_count,
            resolved.complete,
        );
        tracing::Span::current().record("groups", summary.groups.len());
        Ok(summary)
    }

    #[tracing::instrument(
        name = "time.export",
        skip_all,
        fields(
            scope = scope.name(),
            project_id = Empty,
            from = %period.from(),
            to = %period.to(),
            people = Empty,
            scope_tasks = Empty,
            visible_tasks = Empty,
            scope_complete = Empty,
            rows = Empty,
            complete = Empty,
        ),
        err(level = Level::INFO)
    )]
    async fn export(
        &self,
        user_id: &MacroUserIdStr<'static>,
        scope: TimeScope,
        period: TimePeriod,
    ) -> Result<TimeExport, TimeTrackingError> {
        let read = ReportRead::MayLag;
        let resolved = self.resolve(user_id, &scope, period, read).await?;

        // One more than the cap tells whether entries were left out.
        let entries = if resolved.task_ids.is_empty() {
            Vec::new()
        } else {
            self.repo
                .export_entries(
                    ReportFilter {
                        task_ids: &resolved.task_ids,
                        people: resolved.people.as_deref(),
                        period,
                    },
                    MAX_EXPORT_ROWS + 1,
                    read,
                )
                .await
                .map_err(internal)?
        };

        let export = encode_export(&entries, &resolved.tasks, resolved.complete)?;
        let span = tracing::Span::current();
        span.record("rows", export.rows);
        span.record("complete", export.complete);
        Ok(export)
    }
}
