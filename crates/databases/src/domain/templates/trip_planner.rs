//! Trip planner: an itinerary with places, dates and a budget for each stop.

use super::{
    DatabaseTemplate, SELECT, TemplateContext, TemplateIcon, TemplateId, board, create_column,
    create_table, date, insert_rows, number, option, options, table_view, text,
};
use models_databases::{ColumnId, ColumnKind, DatabaseOp, TableId};

pub(super) const TEMPLATE: DatabaseTemplate = DatabaseTemplate {
    id: TemplateId::TripPlanner,
    name: "Trip planner",
    description: "Map out your next getaway with an itinerary, places and a budget.",
    icon: TemplateIcon::MapTrifold,
};

pub(super) fn ops(context: &TemplateContext) -> Vec<DatabaseOp> {
    let itinerary = TableId::new();
    let activity = ColumnId::new();
    let place = ColumnId::new();
    let when = ColumnId::new();
    let category = ColumnId::new();
    let budget = ColumnId::new();
    let categories = options(&["Travel", "Stay", "Explore", "Food"]);
    let [travel, stay, explore, food] = [
        &categories[0],
        &categories[1],
        &categories[2],
        &categories[3],
    ];
    vec![
        create_table(itinerary, "Itinerary"),
        create_column(itinerary, activity, "Activity", ColumnKind::Text, &[]),
        create_column(itinerary, place, "Place", ColumnKind::Text, &[]),
        create_column(itinerary, when, "Date", ColumnKind::Date, &[]),
        create_column(itinerary, category, "Type", SELECT, &categories),
        create_column(itinerary, budget, "Budget", ColumnKind::Number, &[]),
        table_view(itinerary, "By date", None, &[when, activity]),
        board(
            itinerary,
            "By type",
            (category, &categories),
            activity,
            &[place, when, budget],
        ),
        insert_rows(
            itinerary,
            vec![
                vec![
                    text(activity, "Check in at the hotel"),
                    text(place, "Riverside hotel"),
                    date(context, when, 7),
                    option(category, stay),
                    number(budget, 120.0),
                ],
                vec![
                    text(activity, "Explore the old town"),
                    text(place, "Old town square"),
                    date(context, when, 8),
                    option(category, explore),
                    number(budget, 0.0),
                ],
                vec![
                    text(activity, "Dinner by the river"),
                    text(place, "The courtyard café"),
                    date(context, when, 8),
                    option(category, food),
                    number(budget, 35.0),
                ],
                vec![
                    text(activity, "Train to the coast"),
                    text(place, "Central station"),
                    date(context, when, 9),
                    option(category, travel),
                    number(budget, 18.0),
                ],
            ],
        ),
    ]
}
