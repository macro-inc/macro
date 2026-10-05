use chrono::{TimeZone, Utc};
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, SetOperator,
};
use models_databases::{CellValue, ColumnId, ColumnKind, DatabaseId, OptionId, RowId, TableId};
use serde_json::json;
use uuid::Uuid;

use super::*;

const FORM: FormId = FormId::from_uuid(Uuid::from_u128(0xf0));
const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb));
const TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7a));
const SUBMITTED: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x5b));
const TEAM: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0x7e));
const CONTRACTOR: OptionId = OptionId::from_uuid(Uuid::from_u128(0xc0));
const ABOUT_YOU: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x51));
const ELIGIBILITY: FormSectionId = FormSectionId::from_uuid(Uuid::from_u128(0x52));
const TEAM_QUESTION: FormQuestionId = FormQuestionId::from_uuid(Uuid::from_u128(0x91));

#[test]
fn a_form_detail_reads_as_the_web_client_expects() {
    let detail = FormDetail {
        form: Form {
            id: FORM,
            name: "Q4 offsite RSVP".into(),
            description: "Tell us if you can make it.".into(),
            owner_id: "macro|owner@macro.com".into(),
            database_id: DATABASE,
            table_id: TABLE,
            submitted_column_id: Some(SUBMITTED),
            respondent_column_id: None,
            audience: Audience::Members,
            tally_visible: false,
            status: FormStatus::Open,
            closes_at: Some(Utc.with_ymd_and_hms(2026, 10, 3, 17, 0, 0).unwrap()),
            confirmation_message: "".into(),
            created_at: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
            updated_at: Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).unwrap(),
        },
        access: FormAccess::Edit,
        table_gone: false,
        sections: vec![
            FormSectionDetail::Questions {
                id: ABOUT_YOU,
                title: "About you".into(),
                description: "".into(),
                questions: vec![FormQuestionDetail {
                    id: TEAM_QUESTION,
                    column: TEAM,
                    title: "Team".into(),
                    kind: ColumnKind::Select { multi: false },
                    options: vec![QuestionOption {
                        id: CONTRACTOR,
                        label: "Contractor".into(),
                        color: Some("#F5A623".into()),
                    }],
                    help_text: "Where you sit".into(),
                    required: true,
                    widget: Some(Widget::Choice),
                }],
            },
            FormSectionDetail::Gate {
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
                message: "The offsite is for employees.".into(),
            },
        ],
    };

    assert_eq!(
        serde_json::to_value(&detail).unwrap(),
        json!({
            "form": {
                "id": "00000000-0000-0000-0000-0000000000f0",
                "name": "Q4 offsite RSVP",
                "description": "Tell us if you can make it.",
                "ownerId": "macro|owner@macro.com",
                "databaseId": "00000000-0000-0000-0000-0000000000db",
                "tableId": "00000000-0000-0000-0000-00000000007a",
                "submittedColumnId": "00000000-0000-0000-0000-00000000005b",
                "respondentColumnId": null,
                "audience": "members",
                "tallyVisible": false,
                "status": "open",
                "closesAt": "2026-10-03T17:00:00Z",
                "confirmationMessage": "",
                "createdAt": "2026-09-01T09:00:00Z",
                "updatedAt": "2026-09-02T09:00:00Z",
            },
            "access": "edit",
            "tableGone": false,
            "sections": [
                {
                    "kind": "questions",
                    "id": "00000000-0000-0000-0000-000000000051",
                    "title": "About you",
                    "description": "",
                    "questions": [{
                        "id": "00000000-0000-0000-0000-000000000091",
                        "column": "00000000-0000-0000-0000-00000000007e",
                        "title": "Team",
                        "kind": {"type": "select", "multi": false},
                        "options": [{
                            "id": "00000000-0000-0000-0000-0000000000c0",
                            "label": "Contractor",
                            "color": "#F5A623",
                        }],
                        "helpText": "Where you sit",
                        "required": true,
                        "widget": "choice",
                    }],
                },
                {
                    "kind": "gate",
                    "id": "00000000-0000-0000-0000-000000000052",
                    "title": "Eligibility",
                    "description": "",
                    "rules": {
                        "conjunction": "and",
                        "conditions": [{
                            "kind": "condition",
                            "column": "00000000-0000-0000-0000-00000000007e",
                            "test": {
                                "kind": "options",
                                "operator": "isNoneOf",
                                "options": ["00000000-0000-0000-0000-0000000000c0"],
                            },
                        }],
                    },
                    "message": "The offsite is for employees.",
                },
            ],
        })
    );
    let read_back: FormDetail =
        serde_json::from_value(serde_json::to_value(&detail).unwrap()).unwrap();
    assert_eq!(read_back, detail);
}

#[test]
fn a_layout_put_reads_sections_by_kind_and_a_missing_widget_as_default() {
    let layout: FormLayout = serde_json::from_value(json!({
        "sections": [
            {
                "kind": "questions",
                "id": "00000000-0000-0000-0000-000000000051",
                "title": "About you",
                "description": "",
                "questions": [{
                    "id": "00000000-0000-0000-0000-000000000091",
                    "column": "00000000-0000-0000-0000-00000000007e",
                    "helpText": "",
                    "required": false,
                    "widget": null,
                }],
            },
            {
                "kind": "gate",
                "id": "00000000-0000-0000-0000-000000000052",
                "title": "",
                "description": "",
                "rules": {"conjunction": "or", "conditions": []},
                "message": "Sorry",
            },
        ],
    }))
    .unwrap();

    assert_eq!(
        layout,
        FormLayout {
            sections: vec![
                FormSection::Questions {
                    id: ABOUT_YOU,
                    title: "About you".into(),
                    description: "".into(),
                    questions: vec![QuestionLayout {
                        id: TEAM_QUESTION,
                        column: TEAM,
                        help_text: "".into(),
                        required: false,
                        widget: None,
                    }],
                },
                FormSection::Gate {
                    id: ELIGIBILITY,
                    title: "".into(),
                    description: "".into(),
                    rules: FilterGroup {
                        conjunction: Conjunction::Or,
                        conditions: vec![],
                    },
                    message: "Sorry".into(),
                },
            ],
        }
    );
    assert_eq!(layout.sections[1].id(), ELIGIBILITY);
}

#[test]
fn a_create_request_names_its_source_by_kind() {
    let new: CreateForm =
        serde_json::from_value(json!({"name": "RSVP", "source": {"kind": "new"}})).unwrap();
    assert_eq!(new.source, FormSource::New);

    let table: CreateForm = serde_json::from_value(json!({
        "name": "RSVP",
        "source": {
            "kind": "table",
            "databaseId": "00000000-0000-0000-0000-0000000000db",
            "tableId": "00000000-0000-0000-0000-00000000007a",
        },
    }))
    .unwrap();
    assert_eq!(
        table.source,
        FormSource::Table {
            database_id: DATABASE,
            table_id: TABLE,
        }
    );
}

#[test]
fn an_update_tells_a_cleared_closing_time_from_an_untouched_one() {
    let cleared: UpdateForm = serde_json::from_value(json!({"closesAt": null})).unwrap();
    assert_eq!(cleared.closes_at, Some(None));
    assert!(cleared.needs_owner());

    let untouched: UpdateForm =
        serde_json::from_value(json!({"description": "New words"})).unwrap();
    assert_eq!(untouched.closes_at, None);
    assert_eq!(untouched.description.as_deref(), Some("New words"));
    assert!(!untouched.needs_owner());

    let audience: UpdateForm = serde_json::from_value(json!({"audience": "public"})).unwrap();
    assert_eq!(audience.audience, Some(Audience::Public));
    assert!(audience.needs_owner());
}

#[test]
fn a_submission_and_its_outcomes_read_as_tagged_objects() {
    let submission: Submission = serde_json::from_value(json!({
        "answers": [{
            "question": "00000000-0000-0000-0000-000000000091",
            "value": {"type": "options", "value": [{"id": "00000000-0000-0000-0000-0000000000c0"}]},
        }],
    }))
    .unwrap();
    assert_eq!(
        submission.answers,
        vec![Answer {
            question: TEAM_QUESTION,
            value: CellValue::Options(vec![models_databases::OptionRef::Id(CONTRACTOR)]),
        }]
    );

    let response = FormResponseId::from_uuid(Uuid::from_u128(0xe1));
    let row = RowId::from_uuid(Uuid::from_u128(0x40));
    assert_eq!(
        serde_json::to_value(SubmissionOutcome::Submitted { response, row }).unwrap(),
        json!({
            "outcome": "submitted",
            "response": "00000000-0000-0000-0000-0000000000e1",
            "row": "00000000-0000-0000-0000-000000000040",
        })
    );
    assert_eq!(
        serde_json::to_value(SubmissionOutcome::Stopped {
            section: ELIGIBILITY,
            message: "The offsite is for employees.".into(),
        })
        .unwrap(),
        json!({
            "outcome": "stopped",
            "section": "00000000-0000-0000-0000-000000000052",
            "message": "The offsite is for employees.",
        })
    );
}

#[test]
fn a_tally_names_options_and_checkbox_states() {
    let tally = FormTally {
        questions: vec![QuestionTally {
            question: TEAM_QUESTION,
            responses: 3,
            buckets: vec![
                TallyBucket {
                    value: TallyValue::Option { option: CONTRACTOR },
                    count: 2,
                },
                TallyBucket {
                    value: TallyValue::Checkbox { checked: true },
                    count: 1,
                },
            ],
        }],
    };
    assert_eq!(
        serde_json::to_value(tally).unwrap(),
        json!({
            "questions": [{
                "question": "00000000-0000-0000-0000-000000000091",
                "responses": 3,
                "buckets": [
                    {"value": {"kind": "option", "option": "00000000-0000-0000-0000-0000000000c0"}, "count": 2},
                    {"value": {"kind": "checkbox", "checked": true}, "count": 1},
                ],
            }],
        })
    );
}

#[test]
fn an_error_names_its_code_question_and_layout_problem() {
    let error = FormErrorResponse {
        code: FormErrorCode::InvalidLayout,
        message: "a gate can only test questions of earlier sections".into(),
        question: None,
        problem: Some(LayoutProblem::GateNamesLaterColumn { column: TEAM }),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({
            "code": "invalidLayout",
            "message": "a gate can only test questions of earlier sections",
            "question": null,
            "problem": {
                "kind": "gateNamesLaterColumn",
                "column": "00000000-0000-0000-0000-00000000007e",
            },
        })
    );
}

#[test]
fn a_form_takes_responses_while_open_and_before_it_closes() {
    let now = Utc.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap();
    let form = |status, closes_at| Form {
        id: FORM,
        name: "RSVP".into(),
        description: "".into(),
        owner_id: "macro|owner@macro.com".into(),
        database_id: DATABASE,
        table_id: TABLE,
        submitted_column_id: None,
        respondent_column_id: None,
        audience: Audience::Members,
        tally_visible: false,
        status,
        closes_at,
        confirmation_message: "".into(),
        created_at: now,
        updated_at: now,
    };
    assert!(form(FormStatus::Open, None).accepts_responses_at(now));
    assert!(
        form(FormStatus::Open, Some(now + chrono::Duration::hours(1))).accepts_responses_at(now)
    );
    assert!(!form(FormStatus::Open, Some(now)).accepts_responses_at(now));
    assert!(!form(FormStatus::Closed, None).accepts_responses_at(now));
}

#[test]
fn a_listed_form_names_the_callers_access_beside_the_form() {
    let now = Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap();
    let listed = ListedForm {
        form: Form {
            id: FORM,
            name: "RSVP".into(),
            description: "".into(),
            owner_id: "macro|owner@macro.com".into(),
            database_id: DATABASE,
            table_id: TABLE,
            submitted_column_id: None,
            respondent_column_id: None,
            audience: Audience::Public,
            tally_visible: true,
            status: FormStatus::Closed,
            closes_at: None,
            confirmation_message: "Thanks".into(),
            created_at: now,
            updated_at: now,
        },
        access: FormAccess::View,
    };
    assert_eq!(
        serde_json::to_value(&listed).unwrap(),
        json!({
            "form": {
                "id": "00000000-0000-0000-0000-0000000000f0",
                "name": "RSVP",
                "description": "",
                "ownerId": "macro|owner@macro.com",
                "databaseId": "00000000-0000-0000-0000-0000000000db",
                "tableId": "00000000-0000-0000-0000-00000000007a",
                "submittedColumnId": null,
                "respondentColumnId": null,
                "audience": "public",
                "tallyVisible": true,
                "status": "closed",
                "closesAt": null,
                "confirmationMessage": "Thanks",
                "createdAt": "2026-09-01T09:00:00Z",
                "updatedAt": "2026-09-01T09:00:00Z",
            },
            "access": "view",
        })
    );
}
