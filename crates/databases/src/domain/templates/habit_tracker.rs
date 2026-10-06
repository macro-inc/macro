//! Habit tracker: routines, goals and completion dates, with a status board.

use super::{
    DatabaseTemplate, SELECT, TemplateContext, TemplateIcon, TemplateId, board, create_column,
    create_table, date, insert_rows, option, option_filter, options, table_view, text,
};
use models_databases::views::SetOperator;
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::HabitTracker,
    name: "Habit tracker",
    description: "Keep routines, goals and recent completions in one place.",
    icon: TemplateIcon::Checks,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let habits = TableId::new();
    let name = ColumnId::new();
    let frequency = ColumnId::new();
    let goal = ColumnId::new();
    let status = ColumnId::new();
    let completed = ColumnId::new();
    let frequencies = options(&["Daily", "Weekdays", "Weekly"]);
    let [daily, weekdays, weekly] = [&frequencies[0], &frequencies[1], &frequencies[2]];
    let statuses = options(&["To do", "Done", "Skipped"]);
    let [todo, done] = [&statuses[0], &statuses[1]];
    vec![
        create_table(habits, "Habits"),
        create_column(habits, name, "Habit", ColumnKind::Text, &[]),
        create_column(habits, frequency, "Frequency", SELECT, &frequencies),
        create_column(habits, goal, "Goal", ColumnKind::Text, &[]),
        create_column(habits, status, "Status", SELECT, &statuses),
        create_column(habits, completed, "Last completed", ColumnKind::Date, &[]),
        table_view(
            habits,
            "To do",
            Some(option_filter(status, SetOperator::IsAnyOf, &[todo])),
            &[frequency, name],
        ),
        board(
            habits,
            "Progress",
            (status, &statuses),
            name,
            &[frequency, goal],
        ),
        insert_rows(
            habits,
            vec![
                vec![
                    text(name, "Morning walk"),
                    option(frequency, daily),
                    text(goal, "20 minutes outside"),
                    option(status, done),
                    date(context, completed, 0),
                ],
                vec![
                    text(name, "Read a book"),
                    option(frequency, daily),
                    text(goal, "20 pages"),
                    option(status, todo),
                    date(context, completed, -1),
                ],
                vec![
                    text(name, "Stretch"),
                    option(frequency, weekdays),
                    text(goal, "10 minutes"),
                    option(status, todo),
                    date(context, completed, -1),
                ],
                vec![
                    text(name, "Weekly review"),
                    option(frequency, weekly),
                    text(goal, "Reflect and plan the week"),
                    option(status, todo),
                    date(context, completed, -7),
                ],
            ],
        ),
    ]
}
