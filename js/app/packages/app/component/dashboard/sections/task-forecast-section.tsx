import { DashboardSection } from '../dashboard-section';

export function TaskForecastSection() {
  return (
    <DashboardSection
      title="Task Forecast"
      description="Upcoming deadlines and suggested priorities"
    >
      <TaskForecastContent />
    </DashboardSection>
  );
}

function TaskForecastContent() {
  // TODO: Fetch task forecast from AI
  return (
    <div class="space-y-3">
      <section aria-labelledby="overdue">
        <h3 id="overdue" class="text-xs font-medium text-failure-ink mb-2">
          Overdue
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No overdue tasks</li>
        </ul>
      </section>
      <section aria-labelledby="today">
        <h3 id="today" class="text-xs font-medium text-ink-muted mb-2">
          Today
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No tasks due today</li>
        </ul>
      </section>
      <section aria-labelledby="this-week">
        <h3 id="this-week" class="text-xs font-medium text-ink-muted mb-2">
          This Week
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No upcoming tasks</li>
        </ul>
      </section>
    </div>
  );
}
