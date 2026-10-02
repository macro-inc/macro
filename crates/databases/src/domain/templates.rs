//! Database templates. A template is one batch of ops that builds a
//! ready-made database out of an empty one: its tables, columns, options,
//! views and sample rows, under ids minted fresh for every use. Templates are
//! code, not stored data, so a database made from one is an ordinary database
//! from its first commit on.

mod content_calendar;
mod crm;
mod event_planner;
mod getting_started;
mod project_tracker;
mod reading_list;

use chrono::{DateTime, NaiveTime, TimeDelta, Utc};
use models_databases::views::{Lane, LaneKey, NewView, RequestedLayout, ViewQuery};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, DatabaseId, DatabaseOp, NewColumn,
    NewOption, OptionRef, RowsChange, TableChange, TableId, ViewChange, ViewId,
};
use serde::{Deserialize, Serialize};

/// Which template, by its stable slug.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::Display,
)]
#[cfg_attr(
    feature = "ai_tools",
    derive(schemars::JsonSchema),
    schemars(rename = "DatabaseTemplateId")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[schema(as = DatabaseTemplateId)]
pub enum TemplateId {
    /// Ideas on a board by stage; every user's first database.
    GettingStarted,
    /// Tasks with a status, owner, due date and priority.
    ProjectTracker,
    /// Companies, their contacts, and a pipeline of deals.
    Crm,
    /// Parties and their invites, with an RSVP board.
    EventPlanner,
    /// Posts by status, channel and publish date.
    ContentCalendar,
    /// Books to read, with a status and a rating.
    ReadingList,
}

/// The icon a template is shown with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
#[schema(as = DatabaseTemplateIcon)]
pub enum TemplateIcon {
    /// A spark, for something to start from.
    Sparkle,
    /// Columns of cards.
    Kanban,
    /// A handshake.
    Handshake,
    /// A party popper.
    Confetti,
    /// A calendar.
    Calendar,
    /// Books.
    Books,
}

/// What a template builds into a new database.
#[derive(Debug, Clone, Copy, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTemplate {
    /// Its stable slug.
    pub id: TemplateId,
    /// Its name, which a database made from it takes by default.
    pub name: &'static str,
    /// What it is for, in a sentence.
    pub description: &'static str,
    /// Its icon.
    pub icon: TemplateIcon,
}

/// What a template's ops are built for: the new database, which a relation
/// names, and the day its sample dates count from.
#[derive(Debug, Clone, Copy)]
pub struct TemplateContext {
    /// The database the ops build.
    pub database: DatabaseId,
    /// Midnight UTC of the day the database is made.
    pub today: DateTime<Utc>,
}

impl TemplateContext {
    /// The context for building into `database` now.
    pub fn new(database: DatabaseId, now: DateTime<Utc>) -> Self {
        Self {
            database,
            today: now.date_naive().and_time(NaiveTime::MIN).and_utc(),
        }
    }
}

/// Every template, in the order a picker lists them.
pub const TEMPLATES: [DatabaseTemplate; 6] = [
    project_tracker::TEMPLATE,
    crm::TEMPLATE,
    event_planner::TEMPLATE,
    content_calendar::TEMPLATE,
    reading_list::TEMPLATE,
    getting_started::TEMPLATE,
];

impl TemplateId {
    /// The template this slug names.
    pub fn template(self) -> &'static DatabaseTemplate {
        match self {
            TemplateId::GettingStarted => &getting_started::TEMPLATE,
            TemplateId::ProjectTracker => &project_tracker::TEMPLATE,
            TemplateId::Crm => &crm::TEMPLATE,
            TemplateId::EventPlanner => &event_planner::TEMPLATE,
            TemplateId::ContentCalendar => &content_calendar::TEMPLATE,
            TemplateId::ReadingList => &reading_list::TEMPLATE,
        }
    }

    /// The ops that build the template into the context's empty database,
    /// under fresh ids.
    pub fn ops(self, context: &TemplateContext) -> Vec<DatabaseOp> {
        match self {
            TemplateId::GettingStarted => getting_started::ops(context),
            TemplateId::ProjectTracker => project_tracker::ops(context),
            TemplateId::Crm => crm::ops(context),
            TemplateId::EventPlanner => event_planner::ops(context),
            TemplateId::ContentCalendar => content_calendar::ops(context),
            TemplateId::ReadingList => reading_list::ops(context),
        }
    }
}

/// A select column's options, in order, each under a fresh id.
fn options(labels: &[&str]) -> Vec<NewOption> {
    labels
        .iter()
        .map(|label| NewOption {
            id: models_databases::OptionId::new(),
            label: (*label).into(),
        })
        .collect()
}

fn create_table(table: TableId, name: &str) -> DatabaseOp {
    DatabaseOp::Table {
        table,
        change: TableChange::Create { name: name.into() },
    }
}

fn create_column(
    table: TableId,
    column: ColumnId,
    name: &str,
    kind: ColumnKind,
    options: &[NewOption],
) -> DatabaseOp {
    DatabaseOp::Column {
        table,
        column,
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: name.into(),
                kind,
                options: options.to_vec(),
                infer_type: false,
            },
            after: None,
        },
    }
}

/// A person column: one Macro user per cell.
const PERSON: ColumnKind = ColumnKind::Entity {
    target: models_databases::EntityKind::User,
    multi: false,
};

/// A single-select column.
const SELECT: ColumnKind = ColumnKind::Select { multi: false };

fn table_view(table: TableId, name: &str) -> DatabaseOp {
    DatabaseOp::View {
        table,
        view: ViewId::new(),
        change: ViewChange::Create {
            view: NewView {
                name: name.into(),
                query: ViewQuery::default(),
                layout: RequestedLayout::Table {
                    columns: Vec::new(),
                },
            },
        },
    }
}

/// A board with a lane per option of `group_by`, in order, its cards titled
/// by `title` and showing `card_fields`.
fn board(
    table: TableId,
    name: &str,
    group_by: (ColumnId, &[NewOption]),
    title: ColumnId,
    card_fields: &[ColumnId],
) -> DatabaseOp {
    let (group_by, lanes) = group_by;
    DatabaseOp::View {
        table,
        view: ViewId::new(),
        change: ViewChange::Create {
            view: NewView {
                name: name.into(),
                query: ViewQuery::default(),
                layout: RequestedLayout::Board {
                    group_by,
                    title: Some(title),
                    lanes: lanes
                        .iter()
                        .map(|option| Lane {
                            key: LaneKey::Option(option.id),
                            hidden: false,
                        })
                        .collect(),
                    card_fields: card_fields.to_vec(),
                    hide_empty_lanes: false,
                },
            },
        },
    }
}

fn insert_rows(table: TableId, rows: Vec<Vec<CellWrite>>) -> DatabaseOp {
    DatabaseOp::Rows {
        table,
        change: RowsChange::Insert { rows },
    }
}

fn text(column: ColumnId, value: &str) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Text(value.into()),
    }
}

fn number(column: ColumnId, value: f64) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Number(value),
    }
}

fn option(column: ColumnId, option: &NewOption) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Options(vec![OptionRef::Id(option.id)]),
    }
}

fn link(column: ColumnId, url: &str) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Link(vec![url.into()]),
    }
}

/// A date `days` after the context's today, or before it when negative.
fn date(context: &TemplateContext, column: ColumnId, days: i64) -> CellWrite {
    CellWrite {
        column,
        value: CellValue::Date(context.today + TimeDelta::days(days)),
    }
}
