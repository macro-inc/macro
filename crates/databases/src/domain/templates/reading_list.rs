//! Reading list: books to read, reading and finished, with a rating.

use super::{
    DatabaseTemplate, SELECT, TemplateContext, TemplateIcon, TemplateId, board, create_column,
    create_table, insert_rows, link, number, option, option_filter, options, table_view, text,
};
use models_databases::views::SetOperator;
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::ReadingList,
    name: "Reading list",
    description: "Books to read, with their author, a status and a rating.",
    icon: TemplateIcon::Books,
};

pub(super) fn ops(_: &TemplateContext) -> Vec<DatabaseOp> {
    let books = TableId::new();
    let title = ColumnId::new();
    let author = ColumnId::new();
    let status = ColumnId::new();
    let rating = ColumnId::new();
    let url = ColumnId::new();
    let statuses = options(&["Want to read", "Reading", "Finished"]);
    let [want_to_read, reading, finished] = [&statuses[0], &statuses[1], &statuses[2]];
    vec![
        create_table(books, "Books"),
        create_column(books, title, "Title", ColumnKind::Text, &[]),
        create_column(books, author, "Author", ColumnKind::Text, &[]),
        create_column(books, status, "Status", SELECT, &statuses),
        create_column(books, rating, "Rating", ColumnKind::Number, &[]),
        create_column(books, url, "Link", ColumnKind::Link, &[]),
        insert_rows(
            books,
            vec![
                vec![
                    text(title, "The Design of Everyday Things"),
                    text(author, "Don Norman"),
                    option(status, finished),
                    number(rating, 5.0),
                    link(
                        url,
                        "https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things",
                    ),
                ],
                vec![
                    text(title, "Thinking in Systems"),
                    text(author, "Donella Meadows"),
                    option(status, reading),
                    link(
                        url,
                        "https://en.wikipedia.org/wiki/Thinking_In_Systems:_A_Primer",
                    ),
                ],
                vec![
                    text(title, "The Pragmatic Programmer"),
                    text(author, "David Thomas and Andrew Hunt"),
                    option(status, want_to_read),
                    link(
                        url,
                        "https://en.wikipedia.org/wiki/The_Pragmatic_Programmer",
                    ),
                ],
            ],
        ),
        table_view(
            books,
            "To read",
            Some(option_filter(status, SetOperator::IsNoneOf, &[finished])),
            &[title],
        ),
        board(
            books,
            "By status",
            (status, &statuses),
            title,
            &[author, rating],
        ),
    ]
}
