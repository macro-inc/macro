//! Getting started: a few ideas on a board by stage, the example every user
//! is given once.

use super::{
    DatabaseTemplate, SELECT, TemplateContext, TemplateIcon, TemplateId, board, create_column,
    create_table, insert_rows, option, options, table_view, text,
};
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::GettingStarted,
    name: "Getting started",
    description: "A few ideas on a board, to try out tables, cards and views.",
    icon: TemplateIcon::Sparkle,
};

pub(super) fn ops(_: &TemplateContext) -> Vec<DatabaseOp> {
    let ideas = TableId::new();
    let name = ColumnId::new();
    let stage = ColumnId::new();
    let stages = options(&["To do", "Doing", "Done"]);
    let [to_do, doing, done] = [&stages[0], &stages[1], &stages[2]];
    vec![
        create_table(ideas, "Ideas"),
        create_column(ideas, name, "Name", ColumnKind::Text, &[]),
        create_column(ideas, stage, "Stage", SELECT, &stages),
        insert_rows(
            ideas,
            vec![
                vec![text(name, "Add your first idea"), option(stage, to_do)],
                vec![text(name, "Try moving a card"), option(stage, doing)],
                vec![
                    text(name, "Explore table and board views"),
                    option(stage, done),
                ],
            ],
        ),
        table_view(ideas, "Table"),
        board(ideas, "Board", (stage, &stages), name, &[]),
    ]
}
