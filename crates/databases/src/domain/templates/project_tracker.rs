//! Project tracker: tasks with a status, owner, due date and priority.

use super::{
    DatabaseTemplate, PERSON, SELECT, TemplateContext, TemplateIcon, TemplateId, board,
    create_column, create_table, date, insert_rows, option, option_filter, options, table_view,
    text,
};
use models_databases::views::SetOperator;
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::ProjectTracker,
    name: "Project tracker",
    description: "Tasks with a status, an owner, a due date and a priority, on a board by status.",
    icon: TemplateIcon::Kanban,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let tasks = TableId::new();
    let name = ColumnId::new();
    let status = ColumnId::new();
    let owner = ColumnId::new();
    let due = ColumnId::new();
    let priority = ColumnId::new();
    let statuses = options(&["To do", "In progress", "Done"]);
    let [to_do, in_progress, done] = [&statuses[0], &statuses[1], &statuses[2]];
    let priorities = options(&["High", "Medium", "Low"]);
    let [high, medium, low] = [&priorities[0], &priorities[1], &priorities[2]];
    vec![
        create_table(tasks, "Tasks"),
        create_column(tasks, name, "Name", ColumnKind::Text, &[]),
        create_column(tasks, status, "Status", SELECT, &statuses),
        create_column(tasks, owner, "Owner", PERSON, &[]),
        create_column(tasks, due, "Due", ColumnKind::Date, &[]),
        create_column(tasks, priority, "Priority", SELECT, &priorities),
        insert_rows(
            tasks,
            vec![
                vec![
                    text(name, "Write the project brief"),
                    option(status, done),
                    date(context, due, -7),
                    option(priority, high),
                ],
                vec![
                    text(name, "Review the designs"),
                    option(status, in_progress),
                    date(context, due, 3),
                    option(priority, medium),
                ],
                vec![
                    text(name, "Plan the launch"),
                    option(status, to_do),
                    date(context, due, 14),
                    option(priority, high),
                ],
                vec![
                    text(name, "Write the release notes"),
                    option(status, to_do),
                    date(context, due, 21),
                    option(priority, low),
                ],
            ],
        ),
        board(
            tasks,
            "By status",
            (status, &statuses),
            name,
            &[owner, due, priority],
        ),
        table_view(
            tasks,
            "Open tasks",
            Some(option_filter(status, SetOperator::IsNoneOf, &[done])),
            &[due, name],
        ),
    ]
}
