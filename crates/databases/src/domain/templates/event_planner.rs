//! Event planner: parties, and the invites sent for them.

use super::{
    DatabaseTemplate, PERSON, SELECT, TemplateContext, TemplateIcon, TemplateId, board,
    create_column, create_table, date, insert_rows, number, option, options, table_view, text,
};
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::EventPlanner,
    name: "Event planner",
    description: "Parties and their invites, with a board of who is coming.",
    icon: TemplateIcon::Confetti,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let parties = TableId::new();
    let party_name = ColumnId::new();
    let location = ColumnId::new();
    let host = ColumnId::new();
    let party_date = ColumnId::new();

    let invites = TableId::new();
    let guest = ColumnId::new();
    let email = ColumnId::new();
    let rsvp = ColumnId::new();
    let plus_ones = ColumnId::new();
    let party = ColumnId::new();
    let answers = options(&["Invited", "Going", "Maybe", "Declined"]);
    let [invited, going, maybe, declined] = [&answers[0], &answers[1], &answers[2], &answers[3]];
    vec![
        create_table(parties, "Parties"),
        create_column(parties, party_name, "Name", ColumnKind::Text, &[]),
        create_column(parties, location, "Location", ColumnKind::Text, &[]),
        create_column(parties, host, "Host", PERSON, &[]),
        create_column(parties, party_date, "Date", ColumnKind::Date, &[]),
        insert_rows(
            parties,
            vec![
                vec![
                    text(party_name, "Summer picnic"),
                    text(location, "Riverside Park"),
                    date(context, party_date, 21),
                ],
                vec![
                    text(party_name, "Year-end dinner"),
                    text(location, "The Long Table"),
                    date(context, party_date, 60),
                ],
            ],
        ),
        create_table(invites, "Invites"),
        create_column(invites, guest, "Guest Name", ColumnKind::Text, &[]),
        create_column(invites, email, "Email", ColumnKind::Text, &[]),
        create_column(invites, rsvp, "RSVP", SELECT, &answers),
        create_column(invites, plus_ones, "Plus Ones", ColumnKind::Number, &[]),
        create_column(
            invites,
            party,
            "Party",
            ColumnKind::Relation {
                database: context.database,
                table: parties,
            },
            &[],
        ),
        insert_rows(
            invites,
            vec![
                vec![
                    text(guest, "Jordan Lee"),
                    text(email, "jordan@example.com"),
                    option(rsvp, going),
                    number(plus_ones, 1.0),
                ],
                vec![
                    text(guest, "Priya Shah"),
                    text(email, "priya@example.com"),
                    option(rsvp, maybe),
                    number(plus_ones, 0.0),
                ],
                vec![
                    text(guest, "Marco Rossi"),
                    text(email, "marco@example.com"),
                    option(rsvp, invited),
                    number(plus_ones, 2.0),
                ],
                vec![
                    text(guest, "Lena Fischer"),
                    text(email, "lena@example.com"),
                    option(rsvp, declined),
                    number(plus_ones, 0.0),
                ],
            ],
        ),
        board(
            invites,
            "RSVPs",
            (rsvp, &answers),
            guest,
            &[plus_ones, party],
        ),
        table_view(invites, "Table"),
    ]
}
