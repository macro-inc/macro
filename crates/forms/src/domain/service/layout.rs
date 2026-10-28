//! A form's layout against its table: the column facts each question joins,
//! the detail a page reads, and the one validation every layout put passes.

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use std::collections::{HashMap, HashSet};

use databases::domain::catalog::{self, PropertyType};
use databases::domain::models::TableDetail;
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_event_broker::MacroEventBroker;
use models_databases::ColumnKind;
use models_databases::views::{FilterGroup, SchemaColumn, ViewLayout, ViewQuery, check};
use models_forms::{MAX_TEXT_LENGTH, MAX_TITLE_LENGTH};
use uuid::Uuid;

use super::{FormsServiceImpl, receipt_access, receipt_form_id, within};
use crate::domain::models::{
    Audience, ColumnId, Form, FormAccess, FormDetail, FormError, FormLayout, FormQuestionDetail,
    FormSection, FormSectionDetail, LayoutProblem, QuestionOption, Widget,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

/// What a question shows and checks of its column.
#[derive(Debug, Clone)]
pub(super) struct QuestionColumn {
    /// The column's name.
    pub(super) name: String,
    /// Its type.
    pub(super) kind: ColumnKind,
    /// Its options, in order.
    pub(super) options: Vec<QuestionOption>,
    /// The column as a gate's rules check against it.
    pub(super) schema: SchemaColumn,
}

/// The table's columns a question can ask, by id. A column whose type no op
/// can name (a reference without a kind) cannot be asked.
pub(super) fn question_columns(table: &TableDetail) -> HashMap<ColumnId, QuestionColumn> {
    table
        .columns
        .iter()
        .filter_map(|column| {
            let kind = catalog::column_kind(&column.column, &column.definition)?;
            let mut options: Vec<_> = column.definition.property_options.iter().collect();
            options.sort_by_key(|option| option.display_order);
            let options: Vec<QuestionOption> = options
                .into_iter()
                .map(|option| QuestionOption {
                    id: option.id.into(),
                    label: catalog::option_display(&option.value),
                    color: option.color.clone(),
                })
                .collect();
            let schema = SchemaColumn::new(
                column.column.id,
                column.name().to_string(),
                PropertyType::of(&column.column, &column.definition).cast_kind(),
                column.is_multi_valued(),
                options.iter().map(|option| option.id).collect(),
            );
            Some((
                column.column.id,
                QuestionColumn {
                    name: column.name().to_string(),
                    kind,
                    options,
                    schema,
                },
            ))
        })
        .collect()
}

/// A form's detail: its layout with each question joined to its column.
/// Without a table, sections keep no questions; a question whose column is
/// gone is left out.
pub(super) fn form_detail(
    form: Form,
    access: FormAccess,
    layout: FormLayout,
    table: Option<&TableDetail>,
) -> FormDetail {
    let columns = table.map(question_columns).unwrap_or_default();
    let audience = form.audience;
    let sections = layout
        .sections
        .into_iter()
        .map(|section| match section {
            FormSection::Booking {
                id,
                title,
                description,
                target,
            } => FormSectionDetail::Booking {
                id,
                title,
                description,
                target: (access >= FormAccess::Edit).then_some(target),
            },
            FormSection::Questions {
                id,
                title,
                description,
                questions,
            } => FormSectionDetail::Questions {
                id,
                title,
                description,
                questions: questions
                    .into_iter()
                    .filter_map(|question| {
                        let column = columns.get(&question.column)?;
                        Some(FormQuestionDetail {
                            id: question.id,
                            column: question.column,
                            title: column.name.clone(),
                            kind: column.kind,
                            options: column.options.clone(),
                            help_text: question.help_text,
                            required: question.required,
                            widget: effective_widget(question.widget, column.kind, audience),
                        })
                    })
                    .collect(),
            },
            FormSection::Gate {
                id,
                title,
                description,
                rules,
                message,
            } => FormSectionDetail::Gate {
                id,
                title,
                description,
                rules,
                message,
            },
        })
        .collect();
    FormDetail {
        form,
        access,
        table_gone: table.is_none(),
        sections,
    }
}

/// Check a layout against the form's table as a whole: every column is the
/// table's, asked once and not written by the form itself; every widget fits
/// its column and a public form asks for no file; every gate tests only
/// columns asked before it, as a view filter would test them; ids are
/// unique and texts within bounds.
pub(super) fn validate_layout(
    layout: &FormLayout,
    form: &Form,
    table: &TableDetail,
) -> Result<(), FormError> {
    let columns = question_columns(table);
    let managed: Vec<ColumnId> = [form.submitted_column_id, form.respondent_column_id]
        .into_iter()
        .flatten()
        .collect();
    let mut ids: HashSet<Uuid> = HashSet::new();
    let mut unique = |id: Uuid| {
        if ids.insert(id) {
            Ok(())
        } else {
            Err(FormError::from(LayoutProblem::RepeatedId { id }))
        }
    };
    let mut asked: HashSet<ColumnId> = HashSet::new();
    for (position, section) in layout.sections.iter().enumerate() {
        match section {
            FormSection::Booking {
                id,
                title,
                description,
                ..
            } => {
                unique(*id.as_uuid())?;
                within(title, MAX_TITLE_LENGTH)?;
                within(description, MAX_TEXT_LENGTH)?;
                if position + 1 != layout.sections.len() {
                    return Err(LayoutProblem::BookingMustBeLast.into());
                }
            }
            FormSection::Questions {
                id,
                title,
                description,
                questions,
            } => {
                unique(*id.as_uuid())?;
                within(title, MAX_TITLE_LENGTH)?;
                within(description, MAX_TEXT_LENGTH)?;
                for question in questions {
                    unique(*question.id.as_uuid())?;
                    within(&question.help_text, MAX_TEXT_LENGTH)?;
                    if managed.contains(&question.column) {
                        return Err(LayoutProblem::ManagedColumn {
                            column: question.column,
                        }
                        .into());
                    }
                    let column =
                        columns
                            .get(&question.column)
                            .ok_or(LayoutProblem::UnknownColumn {
                                column: question.column,
                            })?;
                    // A gate only reads `asked` at its own section, so a
                    // column is asked from here on as soon as it is seen.
                    if !asked.insert(question.column) {
                        return Err(LayoutProblem::RepeatedColumn {
                            column: question.column,
                        }
                        .into());
                    }
                    if let Some(widget) = question.widget {
                        if !widget.fits(column.kind) {
                            return Err(FormError::WidgetMismatch {
                                question: question.id,
                            });
                        }
                        if widget == Widget::File && form.audience == Audience::Public {
                            return Err(FormError::FileUploadNeedsSignIn);
                        }
                    }
                }
            }
            FormSection::Gate {
                id,
                title,
                description,
                rules,
                message,
            } => {
                unique(*id.as_uuid())?;
                within(title, MAX_TITLE_LENGTH)?;
                within(description, MAX_TEXT_LENGTH)?;
                within(message, MAX_TEXT_LENGTH)?;
                gate_fits(rules, &asked, &columns)?;
            }
        }
    }
    Ok(())
}

/// How a question is asked given its column's current type: its own widget
/// while it fits, else the type's default, as the grid may retype a column
/// under a layout. A public form never asks for a file, whatever its stored
/// layout says.
pub(super) fn effective_widget(
    stored: Option<Widget>,
    kind: ColumnKind,
    audience: Audience,
) -> Option<Widget> {
    stored
        .filter(|widget| widget.fits(kind))
        .filter(|widget| !(*widget == Widget::File && audience == Audience::Public))
        .or(Widget::default_for(kind))
}

/// The table's columns a file widget asks for a file on now.
pub(super) fn file_columns(table: &TableDetail) -> Vec<ColumnId> {
    question_columns(table)
        .into_iter()
        .filter(|(_, column)| Widget::File.fits(column.kind))
        .map(|(id, _)| id)
        .collect()
}

/// Check a gate against the columns asked before it: it names only those,
/// and each test fits its column as a view filter's would.
fn gate_fits(
    rules: &FilterGroup,
    asked: &HashSet<ColumnId>,
    columns: &HashMap<ColumnId, QuestionColumn>,
) -> Result<(), LayoutProblem> {
    for condition in rules.conditions() {
        if !asked.contains(&condition.column) {
            return Err(LayoutProblem::GateNamesLaterColumn {
                column: condition.column,
            });
        }
    }
    let earlier: Vec<SchemaColumn> = asked
        .iter()
        .filter_map(|column| columns.get(column))
        .map(|column| column.schema.clone())
        .collect();
    check(
        &ViewQuery {
            filter: Some(rules.clone()),
            sort: vec![],
        },
        &ViewLayout::Table { columns: vec![] },
        &earlier,
    )
    .map_err(|problem| LayoutProblem::GateRule {
        reason: problem.to_string(),
    })
}

/// Check a stored layout's gates against the table as it is now: a column
/// deleted or retyped in the grid can leave a gate naming a question the
/// form no longer asks, or testing a column as it no longer is. Such a gate
/// would stop every respondent, so responding is refused instead until an
/// editor repairs the layout.
pub(super) fn gates_fit_table(
    layout: &FormLayout,
    columns: &HashMap<ColumnId, QuestionColumn>,
) -> Result<(), LayoutProblem> {
    let mut asked: HashSet<ColumnId> = HashSet::new();
    for section in &layout.sections {
        match section {
            FormSection::Booking { .. } => {}
            FormSection::Questions { questions, .. } => asked.extend(
                questions
                    .iter()
                    .map(|question| question.column)
                    .filter(|column| columns.contains_key(column)),
            ),
            FormSection::Gate { rules, .. } => gate_fits(rules, &asked, columns)?,
        }
    }
    Ok(())
}

/// Whether a layout asks for a file anywhere.
pub(super) fn asks_for_a_file(layout: &FormLayout) -> bool {
    layout.sections.iter().any(|section| match section {
        FormSection::Questions { questions, .. } => questions
            .iter()
            .any(|question| question.widget == Some(Widget::File)),
        FormSection::Gate { .. } | FormSection::Booking { .. } => false,
    })
}

impl<Repository, Databases, Access, Events, Now, Broker, Drafts>
    FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
{
    pub(super) async fn read_detail(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormDetail, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let table = self.table_of(&form).await?;
        let layout = self.refresh_layout(&form, table.as_ref()).await?.layout;
        Ok(form_detail(
            form,
            receipt_access(receipt),
            layout,
            table.as_ref(),
        ))
    }

    pub(super) async fn replace_layout(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        layout: FormLayout,
    ) -> Result<models_forms::FormCollaboration, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let table = self.live_table_of(&form).await?;
        let mut refreshed = self.replace_draft(&form, &table, &layout).await?;
        // Publication can race another editor changing the audience or name.
        // Return the current facts instead of overwriting the caller's cache
        // with the pre-write read. The durable write has already succeeded,
        // so a failed follow-up read is a pending publication, not a refusal.
        let form = match self.live_form(form.id).await {
            Ok(current) => current,
            Err(error) => {
                tracing::error!(form_id = %form.id, error = ?error, "saved form draft facts could not be refreshed");
                refreshed.publication_error = Some(models_forms::FormPublicationProblem::Pending);
                form
            }
        };
        Ok(models_forms::FormCollaboration {
            detail: form_detail(
                form,
                receipt_access(receipt),
                refreshed.layout,
                Some(&table),
            ),
            publication_error: refreshed.publication_error,
        })
    }
}
