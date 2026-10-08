//! Resolve complete draft keys and validate the entire intent before provisioning.
#[cfg(test)]
mod test;
use super::models::*;
use models_databases::views::{
    FilterCondition, FilterGroup, FilterNode, FilterTest, SchemaColumn, ViewLayout, ViewQuery,
    check,
};
use models_databases::{ColumnId, ColumnKind, OptionId};
use models_forms::{
    FormLayout, FormQuestionId, FormSection, FormSectionId, QuestionLayout, QuestionOption,
};
use std::collections::{BTreeMap, HashMap, HashSet};

/// A fully resolved draft with identities allocated for this creation.
#[derive(Debug, Clone)]
pub struct Prepared {
    /// Valid resolved layout.
    pub layout: FormLayout,
    /// New columns to provision, excluding existing bindings.
    pub columns: Vec<Column>,
    /// Every supplied local identity.
    pub keys: KeyMap,
}
fn fail(code: Code, path: &str, message: &str) -> AuthoringError {
    AuthoringError::new(code, path, message)
}
/// Validate bounded text using the same character units as Forms.
pub fn text(value: &str, max: usize, path: &str) -> Result<(), AuthoringError> {
    if value.chars().count() > max {
        return Err(fail(Code::TextTooLong, path, "Shorten this text."));
    }
    Ok(())
}
fn key(value: &str, seen: &mut HashSet<String>, code: Code) -> Result<(), AuthoringError> {
    if value.is_empty() || value.len() > 100 || !seen.insert(value.into()) {
        return Err(fail(
            code,
            value,
            "Use a unique nonempty key of at most 100 bytes.",
        ));
    }
    Ok(())
}
/// Resolve a complete draft, rejecting unsupported capabilities before any writes.
pub fn prepare(draft: &Draft, existing: &[Column]) -> Result<Prepared, AuthoringError> {
    text(&draft.description, 10_000, "description")?;
    text(&draft.confirmation_message, 10_000, "confirmationMessage")?;
    if draft.sections.len() > 100 {
        return Err(fail(
            Code::TooManySections,
            "sections",
            "Use at most 100 sections.",
        ));
    }
    let mut section_keys = HashSet::new();
    let mut question_keys = HashSet::new();
    let mut names: HashSet<String> = existing
        .iter()
        .map(|c| c.name.trim().to_lowercase())
        .collect();
    let mut bindings = HashSet::new();
    let mut earlier = HashMap::new();
    let mut result = Prepared {
        layout: FormLayout { sections: vec![] },
        columns: vec![],
        keys: KeyMap::default(),
    };
    let mut condition_count = 0;
    for (index, section) in draft.sections.iter().enumerate() {
        let (section_key, title, description) = match section {
            Section::Questions {
                key,
                title,
                description,
                ..
            }
            | Section::Gate {
                key,
                title,
                description,
                ..
            }
            | Section::Booking {
                key,
                title,
                description,
                ..
            } => (key, title, description),
        };
        key(section_key, &mut section_keys, Code::DuplicateSectionKey)?;
        text(title, 200, section_key)?;
        text(description, 10_000, section_key)?;
        let id = FormSectionId::new();
        result.keys.sections.insert(section_key.clone(), id);
        let resolved = match section {
            Section::Questions { questions, .. } => {
                let mut placements = vec![];
                for question in questions {
                    key(
                        &question.key,
                        &mut question_keys,
                        Code::DuplicateQuestionKey,
                    )?;
                    if question_keys.len() > 500 {
                        return Err(fail(
                            Code::TooManyQuestions,
                            "questions",
                            "Use at most 500 questions.",
                        ));
                    }
                    text(&question.help_text, 10_000, &question.key)?;
                    let mut option_map = BTreeMap::new();
                    let column = match &question.column {
                        ColumnDraft::Existing { column_id } => existing
                            .iter()
                            .find(|c| c.id == *column_id)
                            .cloned()
                            .ok_or_else(|| {
                                fail(
                                    Code::UnknownColumn,
                                    &question.key,
                                    "Select a column of this table from DescribeDatabase.",
                                )
                            })?,
                        ColumnDraft::New {
                            name,
                            kind,
                            options,
                        } => {
                            text(name, 200, &question.key)?;
                            if name.trim().is_empty() || !names.insert(name.trim().to_lowercase()) {
                                return Err(fail(
                                    Code::DuplicateDisplayLabel,
                                    &question.key,
                                    "Column/question names must be unique, ignoring case. Presentation label overrides are unavailable.",
                                ));
                            }
                            if options.len() > 200 {
                                return Err(fail(
                                    Code::TooManyOptions,
                                    &question.key,
                                    "Use at most 200 options.",
                                ));
                            }
                            let choice = matches!(
                                kind,
                                ColumnKind::Select { .. }
                                    | ColumnKind::SelectNumber { .. }
                                    | ColumnKind::Tag
                            );
                            if !choice && !options.is_empty() {
                                return Err(fail(
                                    Code::UnexpectedOptions,
                                    &question.key,
                                    "Only select and tag columns have options.",
                                ));
                            }
                            let mut keys = HashSet::new();
                            let mut labels = HashSet::new();
                            let mut saved = vec![];
                            for option in options {
                                key(&option.key, &mut keys, Code::DuplicateOptionKey)?;
                                text(&option.label, 200, &question.key)?;
                                let label = if matches!(kind, ColumnKind::SelectNumber { .. }) {
                                    let value = finite_number(&option.label).ok_or_else(|| {
                                        fail(
                                            Code::InvalidNumericOption,
                                            &question.key,
                                            "Numeric option labels must be finite numbers.",
                                        )
                                    })?;
                                    models_databases::cast::number_label(value)
                                } else {
                                    option.label.trim().to_string()
                                };
                                if label.is_empty() || !labels.insert(label.to_lowercase()) {
                                    return Err(fail(
                                        Code::DuplicateOptionLabel,
                                        &question.key,
                                        "Use distinct nonempty option labels; numeric equivalents name the same choice.",
                                    ));
                                }
                                let id = OptionId::new();
                                option_map.insert(option.key.clone(), id);
                                saved.push(QuestionOption {
                                    id,
                                    label,
                                    color: None,
                                });
                            }
                            let column = Column {
                                id: ColumnId::new(),
                                name: name.trim().into(),
                                kind: *kind,
                                options: saved,
                            };
                            result.columns.push(column.clone());
                            column
                        }
                    };
                    if matches!(
                        column.kind,
                        ColumnKind::Entity { .. } | ColumnKind::Relation { .. }
                    ) {
                        return Err(fail(
                            Code::ReferencePickerUnavailable,
                            &question.key,
                            "AI authoring does not yet support entity or database-row pickers.",
                        ));
                    }
                    if question.widget.is_some_and(|w| !w.fits(column.kind)) {
                        return Err(fail(
                            Code::UnsupportedWidget,
                            &question.key,
                            "Use null/default or a widget supported by this column kind.",
                        ));
                    }
                    if !bindings.insert(column.id) {
                        return Err(fail(
                            Code::RepeatedColumn,
                            &question.key,
                            "A column may be asked only once.",
                        ));
                    }
                    let question_id = FormQuestionId::new();
                    result
                        .keys
                        .questions
                        .insert(question.key.clone(), question_id);
                    result.keys.columns.insert(question.key.clone(), column.id);
                    result
                        .keys
                        .options
                        .insert(question.key.clone(), option_map.clone());
                    earlier.insert(
                        question.key.clone(),
                        (question_id, column.clone(), option_map),
                    );
                    placements.push(QuestionLayout {
                        id: question_id,
                        column: column.id,
                        help_text: question.help_text.clone(),
                        required: question.required,
                        widget: question.widget,
                    });
                }
                FormSection::Questions {
                    id,
                    title: title.clone(),
                    description: description.clone(),
                    questions: placements,
                }
            }
            Section::Gate { rules, message, .. } => {
                text(message, 10_000, section_key)?;
                let rules = resolve_rules(rules, &earlier, 0, &mut condition_count)?;
                check_rules(
                    &rules,
                    &earlier
                        .values()
                        .map(|(_, c, _)| c.clone())
                        .collect::<Vec<_>>(),
                )?;
                FormSection::Gate {
                    id,
                    title: title.clone(),
                    description: description.clone(),
                    rules,
                    message: message.clone(),
                }
            }
            Section::Booking {
                target,
                qualification,
                ..
            } => {
                if *qualification == Qualification::Required {
                    return Err(fail(
                        Code::QualificationEnforcementUnavailable,
                        section_key,
                        "Only advisory link reveal is supported. Direct booking URLs remain usable independently.",
                    ));
                }
                if index + 1 != draft.sections.len() {
                    return Err(fail(
                        Code::BookingMustBeLast,
                        section_key,
                        "Keep one booking step at the end.",
                    ));
                }
                FormSection::Booking {
                    id,
                    title: title.clone(),
                    description: description.clone(),
                    target: target.clone(),
                }
            }
        };
        result.layout.sections.push(resolved);
    }
    Ok(result)
}
type References = HashMap<String, (FormQuestionId, Column, BTreeMap<String, OptionId>)>;
fn resolve_rules(
    rules: &Rules,
    earlier: &References,
    depth: usize,
    count: &mut usize,
) -> Result<FilterGroup, AuthoringError> {
    if rules.conditions.is_empty() {
        return Err(fail(
            Code::EmptyScreeningGroup,
            "rules",
            "Add a condition or remove the screener; an empty group qualifies everyone.",
        ));
    }
    if depth >= 8 {
        return Err(fail(
            Code::ScreeningTooDeep,
            "rules",
            "Use at most eight levels.",
        ));
    }
    let conditions = rules
        .conditions
        .iter()
        .map(|rule| match rule {
            Rule::Group(group) => {
                resolve_rules(group, earlier, depth + 1, count).map(FilterNode::Group)
            }
            Rule::Condition { question, test } => {
                *count += 1;
                if *count > 200 {
                    return Err(fail(
                        Code::TooManyConditions,
                        "rules",
                        "Use at most 200 conditions.",
                    ));
                }
                let found = match question {
                    Reference::Key { key } => earlier.get(key),
                    Reference::Id { id } => {
                        earlier.values().find(|(question, _, _)| question == id)
                    }
                }
                .ok_or_else(|| {
                    fail(
                        Code::GateReferencesLaterQuestion,
                        "rules.question",
                        "Reference a question in an earlier section.",
                    )
                })?;
                let (_, column, options_by_key) = found;
                let test = match test {
                    Predicate::Value { test } => test.clone(),
                    Predicate::Options { operator, options } => FilterTest::Options {
                        operator: *operator,
                        options: options
                            .iter()
                            .map(|reference| match reference {
                                Reference::Key { key } => {
                                    options_by_key.get(key).copied().ok_or_else(|| {
                                        fail(
                                            Code::UnknownOption,
                                            "rules.options",
                                            "Use an option key declared on this question.",
                                        )
                                    })
                                }
                                Reference::Id { id } => Ok(*id),
                            })
                            .collect::<Result<_, _>>()?,
                    },
                };
                Ok(FilterNode::Condition(FilterCondition {
                    column: column.id,
                    test,
                }))
            }
        })
        .collect::<Result<_, _>>()?;
    Ok(FilterGroup {
        conjunction: rules.conjunction,
        conditions,
    })
}
/// Validate canonical rules against the current schema, including option membership.
pub fn check_rules(rules: &FilterGroup, columns: &[Column]) -> Result<(), AuthoringError> {
    let schema = columns
        .iter()
        .map(|c| {
            SchemaColumn::new(
                c.id,
                c.name.clone(),
                c.kind.into(),
                matches!(
                    c.kind,
                    ColumnKind::Select { multi: true }
                        | ColumnKind::SelectNumber { multi: true }
                        | ColumnKind::Tag
                ),
                c.options.iter().map(|o| o.id).collect(),
            )
        })
        .collect::<Vec<_>>();
    check(
        &ViewQuery {
            filter: Some(rules.clone()),
            sort: vec![],
        },
        &ViewLayout::Table { columns: vec![] },
        &schema,
    )
    .map_err(|e| AuthoringError::new(Code::InvalidGateRule, "rules", e.to_string()))
}

fn finite_number(label: &str) -> Option<f64> {
    use nom::{Parser, combinator::all_consuming, number::complete::double};
    all_consuming(double::<_, nom::error::Error<&str>>)
        .parse(label.trim())
        .ok()
        .map(|(_, number)| number)
        .filter(|number| number.is_finite())
}

/// Validate the final canonical layout before any schema or draft mutation.
/// This adds authoring-only nonempty-screening and capability limits to Forms' checks.
pub fn canonical(
    layout: &FormLayout,
    columns: &[Column],
    managed: &[ColumnId],
    audience: models_forms::Audience,
) -> Result<(), AuthoringError> {
    canonical_preserving(layout, columns, managed, audience, None)
}

/// Validate existing Forms content while restricting only placements authored by this edit.
/// Passing the current layout as `previous` validates sharing without authoring new content.
pub fn canonical_preserving(
    layout: &FormLayout,
    columns: &[Column],
    managed: &[ColumnId],
    audience: models_forms::Audience,
    previous: Option<&FormLayout>,
) -> Result<(), AuthoringError> {
    let previous_questions: Vec<_> = previous
        .into_iter()
        .flat_map(|layout| layout.sections.iter())
        .flat_map(|section| match section {
            FormSection::Questions { questions, .. } => questions.as_slice(),
            _ => &[],
        })
        .collect();
    if layout.sections.len() > 100
        && layout.sections.len() > previous.map_or(0, |layout| layout.sections.len())
    {
        return Err(fail(
            Code::TooManySections,
            "sections",
            "Use at most 100 sections.",
        ));
    }
    let count_conditions = |layout: &FormLayout| -> usize {
        layout
            .sections
            .iter()
            .map(|section| match section {
                FormSection::Gate { rules, .. } => rules.conditions().len(),
                _ => 0,
            })
            .sum()
    };
    let total = count_conditions(layout);
    if total > 200 && total > previous.map_or(0, count_conditions) {
        return Err(fail(
            Code::TooManyConditions,
            "rules",
            "Use at most 200 conditions.",
        ));
    }
    let mut ids = HashSet::new();
    let mut asked = HashSet::new();
    let mut count = 0;
    for (index, section) in layout.sections.iter().enumerate() {
        if !ids.insert(section.id().into_uuid()) {
            return Err(fail(
                Code::InvalidEdit,
                "sections",
                "Section/question ids must be unique.",
            ));
        }
        match section {
            FormSection::Questions {
                title,
                description,
                questions,
                ..
            } => {
                text(title, 200, "section.title")?;
                text(description, 10_000, "section.description")?;
                for q in questions {
                    count += 1;
                    if count > 500 && count > previous_questions.len() {
                        return Err(fail(
                            Code::TooManyQuestions,
                            "questions",
                            "Use at most 500 questions.",
                        ));
                    }
                    if !ids.insert(q.id.into_uuid())
                        || !asked.insert(q.column)
                        || managed.contains(&q.column)
                    {
                        return Err(fail(
                            Code::RepeatedColumn,
                            "question",
                            "Use distinct question ids and non-managed columns, once per form.",
                        ));
                    }
                    let c = columns.iter().find(|c| c.id == q.column).ok_or_else(|| {
                        fail(
                            Code::UnknownColumn,
                            "question.column",
                            "Choose a column of this form's table.",
                        )
                    })?;
                    if !previous_questions.contains(&q)
                        && matches!(
                            c.kind,
                            ColumnKind::Entity { .. } | ColumnKind::Relation { .. }
                        )
                    {
                        return Err(fail(
                            Code::ReferencePickerUnavailable,
                            "question.column",
                            "Reference pickers are not yet supported by AI authoring.",
                        ));
                    }
                    text(&q.help_text, 10_000, "question.helpText")?;
                    if q.widget.is_some_and(|w| !w.fits(c.kind)) {
                        return Err(fail(
                            Code::UnsupportedWidget,
                            "question.widget",
                            "Select a widget supported by the column kind.",
                        ));
                    }
                    if audience == models_forms::Audience::Public
                        && q.widget == Some(models_forms::Widget::File)
                    {
                        return Err(fail(
                            Code::InvalidAccess,
                            "audience",
                            "File questions require members/sign-in.",
                        ));
                    }
                }
            }
            FormSection::Gate {
                title,
                description,
                rules,
                message,
                ..
            } => {
                text(title, 200, "section.title")?;
                text(description, 10_000, "section.description")?;
                text(message, 10_000, "gate.message")?;
                let unchanged_rules = previous.is_some_and(|layout| layout.sections.iter().any(|old| matches!(old,
                    FormSection::Gate { id, rules: previous_rules, .. } if *id == section.id() && previous_rules == rules)));
                if !unchanged_rules {
                    let mut conditions = 0;
                    nonempty(rules, 0, &mut conditions)?;
                }
                if rules
                    .conditions()
                    .iter()
                    .any(|c| !asked.contains(&c.column))
                {
                    return Err(fail(
                        Code::GateReferencesLaterQuestion,
                        "rules",
                        "Screeners may only reference questions in earlier sections.",
                    ));
                }
                check_rules(rules, columns)?;
            }
            FormSection::Booking {
                title, description, ..
            } => {
                text(title, 200, "section.title")?;
                text(description, 10_000, "section.description")?;
                if index + 1 != layout.sections.len() {
                    return Err(fail(
                        Code::BookingMustBeLast,
                        "sections",
                        "Keep one booking step at the end.",
                    ));
                }
            }
        }
    }
    Ok(())
}
fn nonempty(rules: &FilterGroup, depth: usize, count: &mut usize) -> Result<(), AuthoringError> {
    if rules.conditions.is_empty() {
        return Err(fail(
            Code::EmptyScreeningGroup,
            "rules",
            "Remove the empty group or add a condition.",
        ));
    }
    if depth >= 8 {
        return Err(fail(
            Code::ScreeningTooDeep,
            "rules",
            "Use at most eight levels.",
        ));
    }
    for node in &rules.conditions {
        match node {
            FilterNode::Group(g) => nonempty(g, depth + 1, count)?,
            FilterNode::Condition(_) => *count += 1,
        }
    }
    if *count > 200 {
        return Err(fail(
            Code::TooManyConditions,
            "rules",
            "Use at most 200 conditions.",
        ));
    }
    Ok(())
}

/// Validate explicit additive schema identities using the same kind/option rules
/// as creation. Return normalized values under the caller's stable identities.
pub fn additions(
    drafts: &[NewColumnDraft],
    existing: &[Column],
) -> Result<Vec<Column>, AuthoringError> {
    if drafts.len() > 100 {
        return Err(fail(
            Code::TooManyQuestions,
            "newColumns",
            "Add at most 100 columns per edit.",
        ));
    }
    let draft = Draft {
        description: String::new(),
        confirmation_message: String::new(),
        sections: vec![Section::Questions {
            key: "added".into(),
            title: String::new(),
            description: String::new(),
            questions: drafts
                .iter()
                .map(|c| Question {
                    key: c.id.to_string(),
                    column: ColumnDraft::New {
                        name: c.name.clone(),
                        kind: c.kind,
                        options: c
                            .options
                            .iter()
                            .map(|o| OptionDraft {
                                key: o.id.to_string(),
                                label: o.label.clone(),
                            })
                            .collect(),
                    },
                    help_text: String::new(),
                    required: false,
                    widget: None,
                })
                .collect(),
        }],
    };
    let prepared = prepare(&draft, existing)?;
    let mut ids: HashSet<_> = existing
        .iter()
        .map(|c| c.id.into_uuid())
        .chain(
            existing
                .iter()
                .flat_map(|c| c.options.iter().map(|o| o.id.into_uuid())),
        )
        .collect();
    drafts
        .iter()
        .zip(prepared.columns)
        .map(|(draft, mut normalized)| {
            if !ids.insert(draft.id.into_uuid()) {
                return Err(fail(
                    Code::InvalidEdit,
                    "newColumns.id",
                    "Use a fresh unique column id.",
                ));
            }
            normalized.id = draft.id;
            for (option, input) in normalized.options.iter_mut().zip(&draft.options) {
                if !ids.insert(input.id.into_uuid()) || input.color.is_some() {
                    return Err(fail(
                        Code::InvalidEdit,
                        "newColumns.options",
                        "Use fresh option ids without color overrides.",
                    ));
                }
                option.id = input.id;
            }
            Ok(normalized)
        })
        .collect()
}
