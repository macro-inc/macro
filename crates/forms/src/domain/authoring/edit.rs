//! Three-way comparison of targeted layout edits. Loro CAS protects the final commit.
#[cfg(test)]
mod test;
use super::models::*;
use models_databases::ColumnId;
use models_forms::{FormLayout, FormQuestionId, FormSection, FormSectionId, QuestionLayout};

fn conflict(path: impl Into<String>) -> AuthoringError {
    AuthoringError::new(
        Code::ConcurrentFieldChange,
        path,
        "ReadForm again and resolve this field; unrelated changes were preserved.",
    )
}
fn invalid(message: &str) -> AuthoringError {
    AuthoringError::new(Code::InvalidEdit, "changes", message)
}
fn same<T: PartialEq>(base: &T, latest: &T, path: &str) -> Result<(), AuthoringError> {
    if base != latest {
        return Err(conflict(path));
    }
    Ok(())
}
fn section(layout: &FormLayout, id: FormSectionId) -> Result<&FormSection, AuthoringError> {
    layout
        .sections
        .iter()
        .find(|s| s.id() == id)
        .ok_or_else(|| conflict(format!("sections/{id}")))
}
fn section_mut(
    layout: &mut FormLayout,
    id: FormSectionId,
) -> Result<&mut FormSection, AuthoringError> {
    layout
        .sections
        .iter_mut()
        .find(|s| s.id() == id)
        .ok_or_else(|| conflict(format!("sections/{id}")))
}
fn question(
    layout: &FormLayout,
    id: FormQuestionId,
) -> Result<(FormSectionId, &QuestionLayout), AuthoringError> {
    layout
        .sections
        .iter()
        .find_map(|s| match s {
            FormSection::Questions {
                id: section,
                questions,
                ..
            } => questions.iter().find(|q| q.id == id).map(|q| (*section, q)),
            _ => None,
        })
        .ok_or_else(|| conflict(format!("questions/{id}")))
}
fn questions_mut(
    layout: &mut FormLayout,
    id: FormSectionId,
) -> Result<&mut Vec<QuestionLayout>, AuthoringError> {
    match section_mut(layout, id)? {
        FormSection::Questions { questions, .. } => Ok(questions),
        _ => Err(invalid("Choose a questions section.")),
    }
}
fn insert_question(
    layout: &mut FormLayout,
    id: FormSectionId,
    q: QuestionLayout,
    after: Option<FormQuestionId>,
) -> Result<(), AuthoringError> {
    let list = questions_mut(layout, id)?;
    let index = match after {
        None => 0,
        Some(anchor) => list
            .iter()
            .position(|q| q.id == anchor)
            .map(|i| i + 1)
            .ok_or_else(|| conflict("question anchor"))?,
    };
    list.insert(index, q);
    Ok(())
}
fn insert_section(
    layout: &mut FormLayout,
    section: FormSection,
    after: Option<FormSectionId>,
) -> Result<(), AuthoringError> {
    let index = match after {
        None => 0,
        Some(anchor) => layout
            .sections
            .iter()
            .position(|s| s.id() == anchor)
            .map(|i| i + 1)
            .ok_or_else(|| conflict("section anchor"))?,
    };
    layout.sections.insert(index, section);
    Ok(())
}
fn previous_section(
    layout: &FormLayout,
    id: FormSectionId,
) -> Result<Option<FormSectionId>, AuthoringError> {
    let index = layout
        .sections
        .iter()
        .position(|s| s.id() == id)
        .ok_or_else(|| conflict("section"))?;
    Ok(index.checked_sub(1).map(|i| layout.sections[i].id()))
}
fn previous_question(
    layout: &FormLayout,
    id: FormQuestionId,
) -> Result<(FormSectionId, Option<FormQuestionId>), AuthoringError> {
    let (parent, _) = question(layout, id)?;
    let FormSection::Questions { questions, .. } = section(layout, parent)? else {
        unreachable!()
    };
    let index = questions
        .iter()
        .position(|q| q.id == id)
        .ok_or_else(|| conflict("question"))?;
    Ok((parent, index.checked_sub(1).map(|i| questions[i].id)))
}
fn texts(section: &FormSection) -> (&String, &String, Option<&String>) {
    match section {
        FormSection::Questions {
            title, description, ..
        }
        | FormSection::Booking {
            title, description, ..
        } => (title, description, None),
        FormSection::Gate {
            title,
            description,
            message,
            ..
        } => (title, description, Some(message)),
    }
}
/// Apply a batch to the latest layout after comparing only touched baseline fields.
pub fn apply(
    base: &FormLayout,
    latest: &FormLayout,
    changes: &[Change],
) -> Result<FormLayout, AuthoringError> {
    if changes.len() > 100 {
        return Err(invalid("Use at most 100 operations."));
    }
    let mut expected = base.clone();
    let mut next = latest.clone();
    for change in changes {
        next = apply_step(&expected, &next, change)?;
        expected = apply_step(&expected, &expected, change)?;
    }
    Ok(next)
}

fn apply_step(
    base: &FormLayout,
    latest: &FormLayout,
    change: &Change,
) -> Result<FormLayout, AuthoringError> {
    let mut next = latest.clone();
    {
        match change {
            Change::SetQuestion {
                question_id,
                help_text,
                required,
                widget,
            } => {
                let (_, before) = question(base, *question_id)?;
                let (parent, now) = question(latest, *question_id)?;
                same(&before.column, &now.column, "question.column")?;
                if help_text.is_some() {
                    same(&before.help_text, &now.help_text, "question.helpText")?;
                }
                if required.is_some() {
                    same(&before.required, &now.required, "question.required")?;
                }
                if widget.is_some() {
                    same(&before.widget, &now.widget, "question.widget")?;
                }
                let target = questions_mut(&mut next, parent)?
                    .iter_mut()
                    .find(|q| q.id == *question_id)
                    .ok_or_else(|| invalid("Question removed earlier in this batch."))?;
                if let Some(text) = help_text {
                    target.help_text = text.clone();
                }
                if let Some(value) = required {
                    target.required = *value;
                }
                if let Some(value) = widget {
                    target.widget = match value {
                        WidgetChange::Default => None,
                        WidgetChange::Set { widget } => Some(*widget),
                    };
                }
            }
            Change::SetSectionText {
                section_id,
                title,
                description,
                message,
            } => {
                let before = texts(section(base, *section_id)?);
                let now = texts(section(latest, *section_id)?);
                if title.is_some() {
                    same(before.0, now.0, "section.title")?;
                }
                if description.is_some() {
                    same(before.1, now.1, "section.description")?;
                }
                if message.is_some() {
                    same(&before.2, &now.2, "section.message")?;
                }
                let target = section_mut(&mut next, *section_id)?;
                match target {
                    FormSection::Questions {
                        title: t,
                        description: d,
                        ..
                    }
                    | FormSection::Booking {
                        title: t,
                        description: d,
                        ..
                    } => {
                        if message.is_some() {
                            return Err(invalid("Only a gate has a stop message."));
                        }
                        if let Some(value) = title {
                            *t = value.clone();
                        }
                        if let Some(value) = description {
                            *d = value.clone();
                        }
                    }
                    FormSection::Gate {
                        title: t,
                        description: d,
                        message: m,
                        ..
                    } => {
                        if let Some(value) = title {
                            *t = value.clone();
                        }
                        if let Some(value) = description {
                            *d = value.clone();
                        }
                        if let Some(value) = message {
                            *m = value.clone();
                        }
                    }
                }
            }
            Change::SetGateRules { section_id, rules } => {
                let (FormSection::Gate { rules: before, .. }, FormSection::Gate { rules: now, .. }) =
                    (section(base, *section_id)?, section(latest, *section_id)?)
                else {
                    return Err(invalid("Select a gate."));
                };
                same(before, now, "gate.rules")?;
                // A gate's meaning also depends on all earlier placements and order.
                same(
                    &gate_dependencies(base, *section_id)?,
                    &gate_dependencies(latest, *section_id)?,
                    "gate.dependencies",
                )?;
                let FormSection::Gate { rules: target, .. } = section_mut(&mut next, *section_id)?
                else {
                    return Err(invalid("Select a gate."));
                };
                *target = rules.clone();
            }
            Change::SetBookingTarget {
                section_id,
                target,
                qualification,
            } => {
                if *qualification == Qualification::Required {
                    return Err(AuthoringError::new(
                        Code::QualificationEnforcementUnavailable,
                        "qualification",
                        "Only advisory booking-link reveal is supported.",
                    ));
                }
                let (
                    FormSection::Booking { target: before, .. },
                    FormSection::Booking { target: now, .. },
                ) = (section(base, *section_id)?, section(latest, *section_id)?)
                else {
                    return Err(invalid("Select a booking section."));
                };
                same(before, now, "booking.target")?;
                let FormSection::Booking { target: saved, .. } =
                    section_mut(&mut next, *section_id)?
                else {
                    return Err(invalid("Select a booking section."));
                };
                *saved = target.clone();
            }
            Change::AddSection {
                section: new,
                after,
            } => {
                if next.sections.iter().any(|s| s.id() == new.id()) {
                    return Err(invalid("Use a fresh section id."));
                }
                insert_section(&mut next, new.clone(), *after)?;
            }
            Change::MoveSection { section_id, after } => {
                same(
                    &previous_section(base, *section_id)?,
                    &previous_section(latest, *section_id)?,
                    "section.position",
                )?;
                let moved = section(&next, *section_id)?.clone();
                next.sections.retain(|s| s.id() != *section_id);
                insert_section(&mut next, moved, *after)?;
            }
            Change::RemoveSection { section_id } => {
                same(
                    section(base, *section_id)?,
                    section(latest, *section_id)?,
                    "section",
                )?;
                if let FormSection::Questions { questions, .. } = section(base, *section_id)? {
                    for q in questions {
                        same(
                            &references(base, q.column),
                            &references(latest, q.column),
                            "section.references",
                        )?;
                    }
                }
                next.sections.retain(|s| s.id() != *section_id);
            }
            Change::AddQuestion {
                section_id,
                question: new,
                after,
            } => {
                if question(&next, new.id).is_ok() {
                    return Err(invalid("Use a fresh question id."));
                }
                insert_question(&mut next, *section_id, new.clone(), *after)?;
            }
            Change::MoveQuestion {
                question_id,
                section_id,
                after,
            } => {
                same(
                    &previous_question(base, *question_id)?,
                    &previous_question(latest, *question_id)?,
                    "question.position",
                )?;
                let (parent, moved) = question(&next, *question_id)?;
                let moved = moved.clone();
                questions_mut(&mut next, parent)?.retain(|q| q.id != *question_id);
                insert_question(&mut next, *section_id, moved, *after)?;
            }
            Change::RemoveQuestion { question_id } => {
                same(
                    &question(base, *question_id)?,
                    &question(latest, *question_id)?,
                    "question",
                )?;
                let (_, q) = question(base, *question_id)?;
                same(
                    &references(base, q.column),
                    &references(latest, q.column),
                    "question.references",
                )?;
                let (parent, _) = question(&next, *question_id)?;
                questions_mut(&mut next, parent)?.retain(|q| q.id != *question_id);
            }
        }
    }
    Ok(next)
}
type GateDependencies = Vec<(FormSectionId, Vec<(FormQuestionId, ColumnId)>)>;

fn gate_dependencies(
    layout: &FormLayout,
    id: FormSectionId,
) -> Result<GateDependencies, AuthoringError> {
    section(layout, id)?;
    Ok(layout
        .sections
        .iter()
        .take_while(|s| s.id() != id)
        .map(|s| {
            (
                s.id(),
                match s {
                    FormSection::Questions { questions, .. } => {
                        questions.iter().map(|q| (q.id, q.column)).collect()
                    }
                    _ => vec![],
                },
            )
        })
        .collect())
}

fn references(
    layout: &FormLayout,
    column: ColumnId,
) -> Vec<(FormSectionId, &models_databases::views::FilterGroup)> {
    layout
        .sections
        .iter()
        .filter_map(|section| match section {
            FormSection::Gate { id, rules, .. }
                if rules
                    .conditions()
                    .iter()
                    .any(|condition| condition.column == column) =>
            {
                Some((*id, rules))
            }
            _ => None,
        })
        .collect()
}
