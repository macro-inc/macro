//! A submission's answers against a form's layout: shape and required
//! checks, labels resolved to options, and the gates, walked in section
//! order. The databases service stays the authority on whether a value fits
//! its column; this checks only what the form must decide itself.

use std::collections::HashMap;

use models_databases::views::eval;
use models_databases::{CellValue, ColumnId, ColumnKind, OptionRef};

use super::layout::QuestionColumn;
use crate::domain::models::{
    Answer, FormError, FormLayout, FormQuestionId, FormSection, FormSectionId,
};

/// What a submission's answers come to.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Evaluation {
    /// Every gate passed: each question of the form in layout order, with
    /// its answer or `None` when unanswered.
    Passed(Vec<AnsweredQuestion>),
    /// A gate stopped the respondent.
    Stopped {
        /// The gate.
        section: FormSectionId,
        /// Its message.
        message: String,
    },
}

/// One question of a passed submission.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct AnsweredQuestion {
    /// The question.
    pub(super) question: FormQuestionId,
    /// The column it writes.
    pub(super) column: ColumnId,
    /// Its answer, normalized; `None` when unanswered.
    pub(super) value: Option<CellValue>,
}

/// Check `answers` against `layout` over the table's `columns` and run the
/// gates. Required questions are checked section by section up to the first
/// gate that stops the respondent; sections after it are never reached, so
/// their questions need no answers.
pub(super) fn evaluate(
    layout: &FormLayout,
    columns: &HashMap<ColumnId, QuestionColumn>,
    answers: &[Answer],
) -> Result<Evaluation, FormError> {
    let asked: HashMap<FormQuestionId, &QuestionColumn> = layout
        .sections
        .iter()
        .flat_map(|section| match section {
            FormSection::Questions { questions, .. } => questions.as_slice(),
            FormSection::Gate { .. } | FormSection::Booking { .. } => &[],
        })
        .filter_map(|question| {
            columns
                .get(&question.column)
                .map(|column| (question.id, column))
        })
        .collect();
    let mut given: HashMap<FormQuestionId, Option<CellValue>> = HashMap::new();
    for answer in answers {
        let column = asked
            .get(&answer.question)
            .ok_or(FormError::UnknownQuestion {
                question: answer.question,
            })?;
        let value = normalized(answer.question, column, &answer.value)?;
        if given.insert(answer.question, value).is_some() {
            return Err(FormError::RepeatedAnswer {
                question: answer.question,
            });
        }
    }

    let mut reached: Vec<AnsweredQuestion> = Vec::new();
    let mut cells: HashMap<ColumnId, CellValue> = HashMap::new();
    for section in &layout.sections {
        match section {
            FormSection::Booking { .. } => {}
            FormSection::Questions { questions, .. } => {
                for question in questions {
                    if !asked.contains_key(&question.id) {
                        continue;
                    }
                    let value = given.remove(&question.id).flatten();
                    if question.required && value.is_none() {
                        return Err(FormError::MissingAnswer {
                            question: question.id,
                        });
                    }
                    if let Some(value) = &value {
                        cells.insert(question.column, value.clone());
                    }
                    reached.push(AnsweredQuestion {
                        question: question.id,
                        column: question.column,
                        value,
                    });
                }
            }
            FormSection::Gate {
                id, rules, message, ..
            } => {
                if !eval::matches(rules, &cells) {
                    return Ok(Evaluation::Stopped {
                        section: *id,
                        message: message.clone(),
                    });
                }
            }
        }
    }
    Ok(Evaluation::Passed(reached))
}

/// An answer as the form writes it: `None` for no answer (clear, blank text,
/// nothing chosen), options named by id, and refused when its shape cannot
/// fit the column at all.
fn normalized(
    question: FormQuestionId,
    column: &QuestionColumn,
    value: &CellValue,
) -> Result<Option<CellValue>, FormError> {
    let invalid = |reason: String| FormError::InvalidAnswer { question, reason };
    let at_most_one = |count: usize, multi: bool| {
        if count > 1 && !multi {
            Err(invalid(format!("\"{}\" takes one answer", column.name)))
        } else {
            Ok(())
        }
    };
    let misfit = || {
        invalid(format!(
            "\"{}\" does not take {}",
            column.name,
            value_name(value)
        ))
    };
    match (column.kind, value) {
        (_, CellValue::Clear) => Ok(None),
        (ColumnKind::Text, CellValue::Text(text)) => {
            Ok((!text.trim().is_empty()).then(|| value.clone()))
        }
        (ColumnKind::Number, CellValue::Number(number)) => {
            if number.is_finite() {
                Ok(Some(value.clone()))
            } else {
                Err(invalid("a number must be finite".to_string()))
            }
        }
        (ColumnKind::Boolean, CellValue::Boolean(_)) | (ColumnKind::Date, CellValue::Date(_)) => {
            Ok(Some(value.clone()))
        }
        (ColumnKind::Link, CellValue::Link(urls)) => {
            at_most_one(urls.len(), false)?;
            Ok((!urls.is_empty()).then(|| value.clone()))
        }
        (
            ColumnKind::Select { .. } | ColumnKind::SelectNumber { .. } | ColumnKind::Tag,
            CellValue::Options(options),
        ) => {
            let multi = match column.kind {
                ColumnKind::Select { multi } | ColumnKind::SelectNumber { multi } => multi,
                _ => true,
            };
            at_most_one(options.len(), multi)?;
            let mut ids = Vec::with_capacity(options.len());
            for option in options {
                let id = column
                    .options
                    .iter()
                    .find(|candidate| match option {
                        OptionRef::Id(id) => candidate.id == *id,
                        OptionRef::Label(label) => {
                            candidate.label.trim().to_lowercase() == label.trim().to_lowercase()
                        }
                    })
                    .map(|candidate| candidate.id)
                    .ok_or_else(|| invalid(format!("\"{}\" has no such option", column.name)))?;
                if !ids.contains(&OptionRef::Id(id)) {
                    ids.push(OptionRef::Id(id));
                }
            }
            Ok((!ids.is_empty()).then_some(CellValue::Options(ids)))
        }
        (ColumnKind::Entity { target, multi }, CellValue::Entities(references)) => {
            at_most_one(references.len(), multi)?;
            if let Some(reference) = references
                .iter()
                .find(|reference| reference.entity_type != target)
            {
                return Err(invalid(format!(
                    "\"{}\" points at {}; a {} does not fit",
                    column.name,
                    target.name(),
                    reference.entity_type.name()
                )));
            }
            Ok((!references.is_empty()).then(|| value.clone()))
        }
        (ColumnKind::Relation { .. }, CellValue::Rows(rows)) => {
            Ok((!rows.is_empty()).then(|| value.clone()))
        }
        _ => Err(misfit()),
    }
}

fn value_name(value: &CellValue) -> &'static str {
    match value {
        CellValue::Text(_) => "text",
        CellValue::Number(_) => "a number",
        CellValue::Boolean(_) => "a checkbox",
        CellValue::Date(_) => "a date",
        CellValue::Link(_) => "a link",
        CellValue::Options(_) => "options",
        CellValue::Entities(_) => "references",
        CellValue::Rows(_) => "rows",
        CellValue::Clear => "nothing",
    }
}
