use loro::{ExportMode, LoroDoc, LoroMap, LoroMovableList, LoroText};
use models_databases::ColumnId;
use models_databases::views::{
    Conjunction, FilterCondition, FilterGroup, FilterNode, FilterTest, TextOperator,
};
use models_forms::{
    FormLayout, FormQuestionId, FormSection, FormSectionId, QuestionLayout, Widget,
};
use uuid::uuid;

use super::*;

mod booking_order;
mod concurrent_deletes;
mod concurrent_edits;
mod reading;
mod replacement_repair;
mod seeding;

const CONTACT: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000001"));
const SCREENING: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000002"));
const DETAILS: FormSectionId =
    FormSectionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000003"));
const NAME: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000011"));
const EMAIL: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000012"));
const PHONE: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000013"));
const ADDRESS: FormQuestionId =
    FormQuestionId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000014"));
const NAME_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000021"));
const EMAIL_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000022"));
const PHONE_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000023"));
const ADDRESS_COLUMN: ColumnId = ColumnId::from_uuid(uuid!("0199a000-0000-7000-8000-000000000024"));

/// The layout both cross-language fixtures hold.
fn fixture_layout() -> FormLayout {
    FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: "How we reach you".to_owned(),
                questions: vec![
                    QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your full name".to_owned(),
                        required: true,
                        widget: Some(Widget::Short),
                    },
                    QuestionLayout {
                        id: EMAIL,
                        column: EMAIL_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                ],
            },
            FormSection::Gate {
                id: SCREENING,
                title: "Screening".to_owned(),
                description: String::new(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: NAME_COLUMN,
                        test: FilterTest::Text {
                            operator: TextOperator::Is,
                            value: "Ada".to_owned(),
                        },
                    })],
                },
                message: "Only Ada may continue".to_owned(),
            },
            FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    }
}

/// Two question sections, the starting point of every concurrency test.
fn shared_layout() -> FormLayout {
    FormLayout {
        sections: vec![
            FormSection::Questions {
                id: CONTACT,
                title: "Contact".to_owned(),
                description: String::new(),
                questions: vec![
                    QuestionLayout {
                        id: NAME,
                        column: NAME_COLUMN,
                        help_text: "Your name".to_owned(),
                        required: false,
                        widget: None,
                    },
                    QuestionLayout {
                        id: EMAIL,
                        column: EMAIL_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                    QuestionLayout {
                        id: PHONE,
                        column: PHONE_COLUMN,
                        help_text: String::new(),
                        required: false,
                        widget: None,
                    },
                ],
            },
            FormSection::Questions {
                id: DETAILS,
                title: "Details".to_owned(),
                description: String::new(),
                questions: vec![],
            },
        ],
    }
}

/// The layout after importing `updates` into `snapshot` in order.
fn merge(snapshot: &[u8], updates: &[&[u8]]) -> FormLayout {
    let document = LoroDoc::from_snapshot(snapshot).unwrap();
    for update in updates {
        document.import(update).unwrap();
    }
    let merged = document.export(ExportMode::Snapshot).unwrap();
    read_layout(&merged).unwrap().layout
}
