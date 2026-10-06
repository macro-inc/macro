//! Content calendar: posts by status, channel and publish date.

use super::{
    DatabaseTemplate, PERSON, SELECT, TemplateContext, TemplateIcon, TemplateId, board,
    create_column, create_table, date, insert_rows, option, option_filter, options, table_view,
    text,
};
use models_databases::views::SetOperator;
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::ContentCalendar,
    name: "Content calendar",
    description: "Posts with a channel, an author and a publish date, on a board by status.",
    icon: TemplateIcon::Calendar,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let posts = TableId::new();
    let title = ColumnId::new();
    let status = ColumnId::new();
    let channel = ColumnId::new();
    let publish = ColumnId::new();
    let author = ColumnId::new();
    let statuses = options(&["Idea", "Drafting", "Scheduled", "Published"]);
    let [idea, drafting, scheduled, published] =
        [&statuses[0], &statuses[1], &statuses[2], &statuses[3]];
    let channels = options(&["Blog", "Newsletter", "LinkedIn", "X"]);
    let [blog, newsletter, linkedin] = [&channels[0], &channels[1], &channels[2]];
    vec![
        create_table(posts, "Posts"),
        create_column(posts, title, "Title", ColumnKind::Text, &[]),
        create_column(posts, status, "Status", SELECT, &statuses),
        create_column(posts, channel, "Channel", SELECT, &channels),
        create_column(posts, publish, "Publish date", ColumnKind::Date, &[]),
        create_column(posts, author, "Author", PERSON, &[]),
        insert_rows(
            posts,
            vec![
                vec![
                    text(title, "Our latest launch"),
                    option(status, published),
                    option(channel, blog),
                    date(context, publish, -5),
                ],
                vec![
                    text(title, "Monthly product update"),
                    option(status, scheduled),
                    option(channel, newsletter),
                    date(context, publish, 4),
                ],
                vec![
                    text(title, "Behind the scenes with the team"),
                    option(status, drafting),
                    option(channel, linkedin),
                    date(context, publish, 10),
                ],
                vec![text(title, "Customer story"), option(status, idea)],
            ],
        ),
        board(
            posts,
            "By status",
            (status, &statuses),
            title,
            &[channel, publish, author],
        ),
        table_view(
            posts,
            "Publishing queue",
            Some(option_filter(status, SetOperator::IsNoneOf, &[published])),
            &[publish, title],
        ),
    ]
}
