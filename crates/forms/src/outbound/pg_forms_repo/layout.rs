//! A form's layout as `form_sections` and `form_questions` rows, ordered by
//! fractional keys minted afresh on every write.

use std::collections::HashMap;

use models_databases::position::keys_between;
use models_databases::views::FilterGroup;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::{PgFormsRepoError, parsed};
use crate::domain::models::{
    ColumnId, FormId, FormLayout, FormQuestionId, FormSection, FormSectionId, QuestionLayout,
    Widget,
};
use models_forms::BookingTarget;

use models_forms::FormSectionKind;

/// The primary keys a layout's client-minted ids are stored under.
const LAYOUT_KEYS: [&str; 2] = ["form_sections_pkey", "form_questions_pkey"];

/// Every section and question id of a layout.
fn layout_ids(layout: &FormLayout) -> Vec<Uuid> {
    layout
        .sections
        .iter()
        .flat_map(|section| {
            let questions: Vec<Uuid> = match section {
                FormSection::Questions { questions, .. } => questions
                    .iter()
                    .map(|question| question.id.into_uuid())
                    .collect(),
                FormSection::Gate { .. } | FormSection::Booking { .. } => vec![],
            };
            std::iter::once(section.id().into_uuid()).chain(questions)
        })
        .collect()
}

/// One of the layout's ids that another form's section or question has.
pub(super) async fn id_of_another_form<'executor, Executor>(
    executor: Executor,
    form: FormId,
    layout: &FormLayout,
) -> Result<Option<Uuid>, PgFormsRepoError>
where
    Executor: sqlx::PgExecutor<'executor>,
{
    Ok(sqlx::query_scalar!(
        r#"
        SELECT id AS "id!" FROM form_sections WHERE id = ANY($1) AND form_id <> $2
        UNION ALL
        SELECT id AS "id!" FROM form_questions WHERE id = ANY($1) AND form_id <> $2
        LIMIT 1
        "#,
        &layout_ids(layout),
        form.into_uuid(),
    )
    .fetch_optional(executor)
    .await?)
}

/// Whether a failed write broke the uniqueness of a layout id, as the
/// database names the violated constraint.
pub(super) fn is_layout_key_taken(error: &sqlx::Error) -> bool {
    error.as_database_error().is_some_and(|error| {
        error.is_unique_violation()
            && error
                .constraint()
                .is_some_and(|constraint| LAYOUT_KEYS.contains(&constraint))
    })
}

/// Write a layout's sections and questions for a form that has none.
pub(super) async fn insert(
    transaction: &mut Transaction<'_, Postgres>,
    form: FormId,
    layout: &FormLayout,
) -> Result<(), PgFormsRepoError> {
    let positions = keys_between(None, None, layout.sections.len())?;
    let mut section_ids = Vec::new();
    let mut section_positions = Vec::new();
    let mut titles = Vec::new();
    let mut descriptions = Vec::new();
    let mut kinds = Vec::new();
    let mut rules: Vec<Option<String>> = Vec::new();
    let mut messages = Vec::new();
    let mut booking_targets: Vec<Option<String>> = Vec::new();
    let mut question_ids = Vec::new();
    let mut question_sections = Vec::new();
    let mut question_columns = Vec::new();
    let mut question_positions = Vec::new();
    let mut help_texts = Vec::new();
    let mut requireds = Vec::new();
    let mut widgets: Vec<Option<String>> = Vec::new();
    for (section, position) in layout.sections.iter().zip(positions) {
        section_ids.push(section.id().into_uuid());
        section_positions.push(position.to_string());
        match section {
            FormSection::Questions {
                id,
                title,
                description,
                questions,
            } => {
                titles.push(title.clone());
                descriptions.push(description.clone());
                kinds.push(FormSectionKind::Questions.as_ref().to_string());
                rules.push(None);
                messages.push(String::new());
                booking_targets.push(None);
                for (question, position) in
                    questions
                        .iter()
                        .zip(keys_between(None, None, questions.len())?)
                {
                    question_ids.push(question.id.into_uuid());
                    question_sections.push(id.into_uuid());
                    question_columns.push(question.column.into_uuid());
                    question_positions.push(position.to_string());
                    help_texts.push(question.help_text.clone());
                    requireds.push(question.required);
                    widgets.push(question.widget.map(|widget| widget.name().to_string()));
                }
            }
            FormSection::Gate {
                title,
                description,
                rules: gate_rules,
                message,
                ..
            } => {
                titles.push(title.clone());
                descriptions.push(description.clone());
                kinds.push(FormSectionKind::Gate.as_ref().to_string());
                rules.push(Some(serde_json::to_string(gate_rules)?));
                messages.push(message.clone());
                booking_targets.push(None);
            }
            FormSection::Booking {
                title,
                description,
                target,
                ..
            } => {
                titles.push(title.clone());
                descriptions.push(description.clone());
                kinds.push(FormSectionKind::Booking.as_ref().to_string());
                rules.push(None);
                messages.push(String::new());
                booking_targets.push(Some(serde_json::to_string(target)?));
            }
        }
    }
    sqlx::query!(
        r#"
        INSERT INTO form_sections (id, form_id, position, title, description, kind, gate_rules, gate_message, booking_target)
        SELECT section.id, $1, section.position, section.title, section.description,
               section.kind, section.rules::jsonb, section.message, section.booking_target::jsonb
        FROM UNNEST($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
            AS section(id, position, title, description, kind, rules, message, booking_target)
        "#,
        form.into_uuid(),
        &section_ids,
        &section_positions,
        &titles,
        &descriptions,
        &kinds,
        &rules as &[Option<String>],
        &messages,
        &booking_targets as &[Option<String>],
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO form_questions (id, form_id, section_id, column_id, position, help_text, required, widget)
        SELECT question.id, $1, question.section_id, question.column_id, question.position,
               question.help_text, question.required, question.widget
        FROM UNNEST($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::bool[], $8::text[])
            AS question(id, section_id, column_id, position, help_text, required, widget)
        "#,
        form.into_uuid(),
        &question_ids,
        &question_sections,
        &question_columns,
        &question_positions,
        &help_texts,
        &requireds,
        &widgets as &[Option<String>],
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// A booking section's stored destination; missing or misshapen is corrupt.
fn booking_target(stored: Option<serde_json::Value>) -> Result<BookingTarget, PgFormsRepoError> {
    let stored = stored.ok_or(PgFormsRepoError::Corrupt {
        kind: "booking target",
        value: "null".to_string(),
    })?;
    serde_json::from_value(stored.clone()).map_err(|_| PgFormsRepoError::Corrupt {
        kind: "booking target",
        value: stored.to_string(),
    })
}

/// The isolation a layout read runs at: both of its statements see one
/// snapshot, so a layout put committing between them cannot pair old
/// sections with new questions. Read only, so it never blocks a writer.
const SNAPSHOT: &str = "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY";

/// A form's layout, sections and questions in order, as one snapshot.
pub(super) async fn read(pool: &PgPool, form: FormId) -> Result<FormLayout, PgFormsRepoError> {
    let mut snapshot = pool.begin_with(SNAPSHOT).await?;
    let sections = sqlx::query!(
        r#"
        SELECT id, title, description, kind, gate_rules, gate_message, booking_target
        FROM form_sections WHERE form_id = $1
        ORDER BY position, id
        "#,
        form.into_uuid(),
    )
    .fetch_all(&mut *snapshot)
    .await?;
    let questions = sqlx::query!(
        r#"
        SELECT id, section_id, column_id, help_text, required, widget
        FROM form_questions WHERE form_id = $1
        ORDER BY section_id, position, id
        "#,
        form.into_uuid(),
    )
    .fetch_all(&mut *snapshot)
    .await?;
    snapshot.commit().await?;
    let mut by_section: HashMap<Uuid, Vec<QuestionLayout>> = HashMap::new();
    for question in questions {
        by_section
            .entry(question.section_id)
            .or_default()
            .push(QuestionLayout {
                id: FormQuestionId::from_uuid(question.id),
                column: ColumnId::from_uuid(question.column_id),
                help_text: question.help_text,
                required: question.required,
                widget: question
                    .widget
                    .as_deref()
                    .map(|widget| parsed::<Widget>("widget", widget))
                    .transpose()?,
            });
    }
    let sections = sections
        .into_iter()
        .map(|section| {
            let id = FormSectionId::from_uuid(section.id);
            match parsed::<FormSectionKind>("section kind", &section.kind)? {
                FormSectionKind::Questions => Ok(FormSection::Questions {
                    id,
                    title: section.title,
                    description: section.description,
                    questions: by_section.remove(&section.id).unwrap_or_default(),
                }),
                FormSectionKind::Gate => {
                    let rules = section.gate_rules.ok_or(PgFormsRepoError::Corrupt {
                        kind: "gate rules",
                        value: "null".to_string(),
                    })?;
                    Ok(FormSection::Gate {
                        id,
                        title: section.title,
                        description: section.description,
                        rules: serde_json::from_value::<FilterGroup>(rules)?,
                        message: section.gate_message,
                    })
                }
                FormSectionKind::Booking => Ok(FormSection::Booking {
                    id,
                    title: section.title,
                    description: section.description,
                    target: booking_target(section.booking_target)?,
                }),
            }
        })
        .collect::<Result<Vec<_>, PgFormsRepoError>>()?;
    Ok(FormLayout { sections })
}
