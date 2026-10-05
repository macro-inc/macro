//! Service tests: the forms service over in-memory fakes for its repository,
//! the databases service, the clock and the broker, so every use case and
//! every allow/deny decision is asserted at the service boundary.

use std::sync::{Arc, Mutex};

use ::databases::domain::models::Viewer;
use chrono::{DateTime, TimeZone, Utc};
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    RequiredPermission,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, SetOperator,
};
use models_databases::{ColumnId, ColumnKind, EntityKind, OptionId, TableId};
use uuid::Uuid;

use crate::domain::models::{
    Audience, DatabaseId, Form, FormId, FormLayout, FormQuestionId, FormSection, FormSectionId,
    FormStatus, QuestionLayout, StoredForm, Widget,
};

mod booking;
mod catalog;
mod create;
mod drafts;
mod end_to_end;
mod fakes;
mod layout;
mod lifecycle;
mod liveness;
mod names;
mod races;
mod responses;
mod schema_changes;
mod sharing;
mod submit;

use fakes::*;

const OWNER: &str = "macro|owner@macro.com";
const EDITOR: &str = "macro|editor@macro.com";
const VIEWER: &str = "macro|viewer@macro.com";
const STRANGER: &str = "macro|stranger@macro.com";

type Service = FormsServiceImpl<
    FakeRepo,
    FakeDatabases,
    FakeAccess,
    RecordingFormEvents,
    FixedClock,
    RecordingBroker,
    FakeDrafts,
>;

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn viewer(id: &'static str) -> Viewer {
    Viewer {
        user_id: user(id),
        acting_bot: None,
    }
}

/// Monday 1 September 2026, 09:00 UTC: when every test starts.
fn start_of_tests() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap()
}

fn world() -> Shared {
    Arc::new(Mutex::new(World::new(start_of_tests())))
}

fn service(world: &Shared) -> Service {
    FormsServiceImpl::new(
        FakeRepo(world.clone()),
        Arc::new(FakeDatabases(world.clone())),
        FakeAccess(world.clone()),
        RecordingFormEvents(world.clone()),
        FixedClock(world.clone()),
        RecordingBroker(world.clone()),
        FakeDrafts(world.clone()),
    )
}

/// A receipt for `user` holding `level` on the form, as the extractor mints it.
fn form_receipt<Level: RequiredPermission>(
    form: FormId,
    user: &'static str,
    level: AccessLevel,
) -> EntityAccessReceipt<Level> {
    EntityAccessReceipt::try_new_authenticated_user(
        self::user(user),
        Entity {
            entity_id: form.to_string(),
            entity_type: EntityType::Form,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .expect("level satisfies the requirement")
}

/// The receipt the extractor mints for an anonymous visitor of a public form.
fn anonymous_receipt<Level: RequiredPermission>(form: FormId) -> EntityAccessReceipt<Level> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Unauthenticated,
        Entity {
            entity_id: form.to_string(),
            entity_type: EntityType::Form,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("view satisfies the requirement")
}

/// A receipt for `user` holding `level` on a database.
fn database_receipt<Level: RequiredPermission>(
    database: DatabaseId,
    user: &'static str,
    level: AccessLevel,
) -> EntityAccessReceipt<Level> {
    EntityAccessReceipt::try_new_authenticated_user(
        self::user(user),
        Entity {
            entity_id: database.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .expect("level satisfies the requirement")
}

const RSVP_FORM: FormId = FormId::from_uuid(Uuid::from_u128(0xf0f0));
const RSVP_DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdbdb));
const RSVP_TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7a7a));
const SUBMITTED: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x5b01));
const RESPONDENT: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x5b02));
const TEAM: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc001));
const START_DATE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc002));
const DIET: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc003));
const PLUS_ONE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc004));
const NOTES: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc005));
const EMPLOYEE: OptionId = OptionId::from_uuid(Uuid::from_u128(0x0e01));
const CONTRACTOR: OptionId = OptionId::from_uuid(Uuid::from_u128(0x0e02));
const ABOUT_YOU: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5e01));
const ELIGIBILITY: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5e02));
const LOGISTICS: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x5e03));
const TEAM_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9e01));
const START_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9e02));
const DIET_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9e03));
const PLUS_ONE_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x9e04));
const GATE_MESSAGE: &str = "The offsite is for employees.";

/// The RSVP form's layout: Team and Start date (required), a gate refusing
/// contractors, then Diet and Plus one (optional). Notes is a column of the
/// table the form does not ask.
fn rsvp_layout() -> FormLayout {
    FormLayout {
        sections: vec![
            FormSection::Questions {
                id: ABOUT_YOU,
                title: "About you".into(),
                description: "".into(),
                questions: vec![
                    QuestionLayout {
                        id: TEAM_QUESTION,
                        column: TEAM,
                        help_text: "".into(),
                        required: true,
                        widget: None,
                    },
                    QuestionLayout {
                        id: START_QUESTION,
                        column: START_DATE,
                        help_text: "".into(),
                        required: true,
                        widget: Some(Widget::Date),
                    },
                ],
            },
            FormSection::Gate {
                id: ELIGIBILITY,
                title: "Eligibility".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: TEAM,
                        test: FilterTest::Options {
                            operator: SetOperator::IsNoneOf,
                            options: vec![CONTRACTOR],
                        },
                    })],
                },
                message: GATE_MESSAGE.into(),
            },
            FormSection::Questions {
                id: LOGISTICS,
                title: "Logistics".into(),
                description: "".into(),
                questions: vec![
                    QuestionLayout {
                        id: DIET_QUESTION,
                        column: DIET,
                        help_text: "".into(),
                        required: false,
                        widget: None,
                    },
                    QuestionLayout {
                        id: PLUS_ONE_QUESTION,
                        column: PLUS_ONE,
                        help_text: "".into(),
                        required: false,
                        widget: None,
                    },
                ],
            },
        ],
    }
}

/// Seed the world with the RSVP form over its table, owned by [`OWNER`].
fn seed_rsvp(world: &Shared, audience: Audience) {
    let column = |id, name: &str, kind| FakeColumn {
        id,
        name: name.into(),
        kind,
        options: vec![],
    };
    let mut world = world.lock().unwrap();
    world.databases.push(FakeDatabase {
        id: RSVP_DATABASE,
        name: "Q4 offsite RSVP".into(),
        owner: OWNER.into(),
        trashed: false,
        tables: vec![FakeTable {
            id: RSVP_TABLE,
            name: "Responses".into(),
            version: 1,
            columns: vec![
                column(SUBMITTED, "Submitted", ColumnKind::Date),
                column(
                    RESPONDENT,
                    "Respondent",
                    ColumnKind::Entity {
                        target: EntityKind::User,
                        multi: false,
                    },
                ),
                FakeColumn {
                    id: TEAM,
                    name: "Team".into(),
                    kind: ColumnKind::Select { multi: false },
                    options: vec![
                        (EMPLOYEE, "Employee".into()),
                        (CONTRACTOR, "Contractor".into()),
                    ],
                },
                column(START_DATE, "Start date", ColumnKind::Date),
                column(DIET, "Dietary needs", ColumnKind::Text),
                column(PLUS_ONE, "Bringing a plus one", ColumnKind::Boolean),
                column(NOTES, "Notes", ColumnKind::Text),
            ],
            rows: vec![],
        }],
    });
    let now = world.now;
    world.forms.push(StoredForm {
        form: Form {
            id: RSVP_FORM,
            name: "Q4 offsite RSVP".into(),
            description: "".into(),
            owner_id: OWNER.into(),
            database_id: RSVP_DATABASE,
            table_id: RSVP_TABLE,
            submitted_column_id: Some(SUBMITTED),
            respondent_column_id: Some(RESPONDENT),
            audience,
            tally_visible: false,
            status: FormStatus::Open,
            closes_at: None,
            confirmation_message: "".into(),
            created_at: now,
            updated_at: now,
        },
        trashed_at: None,
        name_follows_database: false,
    });
    world.layouts.insert(RSVP_FORM, rsvp_layout());
    world.owner_grants.push((RSVP_FORM, OWNER.into()));
}
