//! Targeted changes to the current layout. Loro merges the resulting document operations.
#[cfg(test)]
mod test;
use super::models::*;
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
/// Apply a batch in order to the live document's layout, preserving omitted fields.
pub fn apply(latest: &FormLayout, changes: &[Change]) -> Result<FormLayout, AuthoringError> {
    if changes.len() > 100 {
        return Err(invalid("Use at most 100 operations."));
    }
    let mut next = latest.clone();
    for change in changes {
        next = apply_step(&next, change)?;
    }
    Ok(next)
}

fn apply_step(latest: &FormLayout, change: &Change) -> Result<FormLayout, AuthoringError> {
    let mut next = latest.clone();
    {
        match change {
            Change::SetQuestion {
                question_id,
                help_text,
                required,
                widget,
            } => {
                let (parent, _) = question(latest, *question_id)?;

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
                let moved = section(&next, *section_id)?.clone();
                next.sections.retain(|s| s.id() != *section_id);
                insert_section(&mut next, moved, *after)?;
            }
            Change::RemoveSection { section_id } => {
                section(&next, *section_id)?;

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
                let (parent, moved) = question(&next, *question_id)?;
                let moved = moved.clone();
                questions_mut(&mut next, parent)?.retain(|q| q.id != *question_id);
                insert_question(&mut next, *section_id, moved, *after)?;
            }
            Change::RemoveQuestion { question_id } => {
                let (parent, _) = question(&next, *question_id)?;
                questions_mut(&mut next, parent)?.retain(|q| q.id != *question_id);
            }
        }
    }
    Ok(next)
}
