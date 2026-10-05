//! Responding: a new response, a signed-in respondent's edit, and reading
//! one's own response back. The forms service decides; the databases
//! service writes the row under the form's internal receipt.

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use databases::domain::models::{DatabaseError, OpBatch, TableDetail, Viewer};
use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{
    CellValue, CellWrite, DatabaseOp, EntityKind, EntityRef, OpResult, RowChange, RowChanges,
    RowsChange, RowsResult,
};
use models_forms::UnlockedBooking;

use super::answers::{AnsweredQuestion, Evaluation, evaluate};
use super::layout::{QuestionColumn, gates_fit_table, question_columns};
use super::managed::{respondent_kind, submitted_kind, writable};
use super::{
    FormsServiceImpl, database_error, internal_receipt, owner_of, receipt_form_id,
    receipt_respondent, repository_error,
};
use crate::domain::events::{FormResponseSubmittedMetadata, FormTopicEvent};
use crate::domain::models::{
    Answer, Audience, ColumnId, Form, FormError, FormLayout, FormResponse, FormSection, MyResponse,
    RecordedResponse, Respondent, ResponseStatus, RowId, Submission, SubmissionOutcome,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

/// The cells of a new row: every answer, then the managed columns the table
/// still has.
fn insert_cells(
    form: &Form,
    columns: &HashMap<ColumnId, QuestionColumn>,
    answered: &[AnsweredQuestion],
    respondent: &Respondent,
    submitted_at: DateTime<Utc>,
) -> Vec<CellWrite> {
    let mut cells: Vec<CellWrite> = answered
        .iter()
        .filter_map(|question| {
            question.value.clone().map(|value| CellWrite {
                column: question.column,
                value,
            })
        })
        .collect();
    if let Some(column) = writable(columns, form.submitted_column_id, submitted_kind()) {
        cells.push(CellWrite {
            column,
            value: CellValue::Date(submitted_at),
        });
    }
    if let (Some(column), Respondent::Member(user)) = (
        writable(columns, form.respondent_column_id, respondent_kind()),
        respondent,
    ) {
        cells.push(CellWrite {
            column,
            value: CellValue::Entities(vec![EntityRef {
                entity_type: EntityKind::User,
                entity_id: user.to_string(),
            }]),
        });
    }
    cells
}

/// The row an insert answered.
fn inserted_row(results: &[OpResult]) -> Result<RowId, FormError> {
    results
        .iter()
        .find_map(|result| match result {
            OpResult::Rows {
                change: RowsResult::Inserted { rows },
                ..
            } => rows.first().copied(),
            _ => None,
        })
        .ok_or_else(|| FormError::DatabaseContract("an insert of one row answered no row"))
}

/// A refused write in the form's terms: an answer the databases service
/// found not to fit is that question's invalid answer.
fn write_error(error: DatabaseError, answered: &[AnsweredQuestion]) -> FormError {
    match error {
        DatabaseError::InvalidOp(refusal) => {
            match refusal.column.and_then(|column| {
                answered
                    .iter()
                    .find(|question| question.column == column)
                    .map(|question| question.question)
            }) {
                Some(question) => FormError::InvalidAnswer {
                    question,
                    reason: refusal.reason,
                },
                None => FormError::Database(DatabaseError::InvalidOp(refusal)),
            }
        }
        DatabaseError::NotFound => FormError::TableGone,
        other => database_error(other),
    }
}

/// The answers a row holds for the layout's questions.
fn answers_of(layout: &FormLayout, cells: &[CellWrite]) -> Vec<Answer> {
    let by_column: HashMap<ColumnId, &CellValue> = cells
        .iter()
        .map(|cell| (cell.column, &cell.value))
        .collect();
    layout
        .sections
        .iter()
        .flat_map(|section| match section {
            FormSection::Questions { questions, .. } => questions.as_slice(),
            FormSection::Gate { .. } | FormSection::Booking { .. } => &[],
        })
        .filter_map(|question| {
            by_column.get(&question.column).map(|value| Answer {
                question: question.id,
                value: (*value).clone(),
            })
        })
        .collect()
}

/// The layout's booking step with its destination, for a response that has
/// passed every gate and been saved.
fn unlocked_booking(layout: &FormLayout) -> Option<UnlockedBooking> {
    layout.sections.iter().find_map(|section| match section {
        FormSection::Booking {
            id,
            title,
            description,
            target,
        } => Some(UnlockedBooking {
            section: *id,
            title: title.clone(),
            description: description.clone(),
            target: target.clone(),
        }),
        FormSection::Questions { .. } | FormSection::Gate { .. } => None,
    })
}

/// Whether a saved row's answers pass the form as it is now: every required
/// question answered and every gate passed.
fn still_passes(
    layout: &FormLayout,
    columns: &HashMap<ColumnId, QuestionColumn>,
    answers: &[Answer],
) -> bool {
    gates_fit_table(layout, columns).is_ok()
        && matches!(
            evaluate(layout, columns, answers),
            Ok(Evaluation::Passed(_))
        )
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
    /// The form, its table and layout for a respondent about to write:
    /// refused when it is closed, its table is gone, or it takes signed-in
    /// members only and nobody is signed in.
    async fn open_for(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        now: DateTime<Utc>,
    ) -> Result<(Form, Respondent, TableDetail, FormLayout), FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        if !form.accepts_responses_at(now) {
            return Err(FormError::Closed);
        }
        let respondent = receipt_respondent(receipt);
        if form.audience == Audience::Members && respondent == Respondent::Anonymous {
            return Err(FormError::SignInRequired);
        }
        let table = self.live_table_of(&form).await?;
        let layout = self.refresh_layout(&form, Some(&table)).await?.layout;
        Ok((form, respondent, table, layout))
    }

    /// Write rows under the form's receipt, as `viewer`.
    async fn write(
        &self,
        form: &Form,
        viewer: MacroUserIdStr<'static>,
        ops: Vec<DatabaseOp>,
        answered: &[AnsweredQuestion],
    ) -> Result<Vec<OpResult>, FormError> {
        self.databases
            .apply_ops(
                internal_receipt::<EditAccessLevel>(form.database_id),
                Viewer {
                    user_id: viewer,
                    acting_bot: None,
                },
                OpBatch::from(ops),
            )
            .await
            .map_err(|error| write_error(error, answered))
    }

    pub(super) async fn submit(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        let now = self.now();
        let (form, respondent, table, layout) = self.open_for(receipt, now).await?;
        if let Respondent::Member(user) = &respondent {
            let existing = self
                .repository
                .response_of(form.id, user)
                .await
                .map_err(repository_error)?;
            if existing.is_some_and(|entry| entry.status == ResponseStatus::Submitted) {
                return Err(FormError::AlreadyResponded);
            }
        }
        let columns = question_columns(&table);
        gates_fit_table(&layout, &columns)?;
        let answered = match evaluate(&layout, &columns, &submission.answers)? {
            Evaluation::Passed(answered) => answered,
            Evaluation::Stopped { section, message } => {
                // Only a signed-in respondent has an entry to stop; an
                // anonymous one leaves no trace.
                if let Respondent::Member(user) = &respondent {
                    self.repository
                        .record_stop(form.id, user, section, now)
                        .await
                        .map_err(repository_error)?;
                    self.announce(form.id).await;
                }
                return Ok(SubmissionOutcome::Stopped { section, message });
            }
        };
        let insert = vec![DatabaseOp::Rows {
            table: form.table_id,
            change: RowsChange::Insert {
                rows: vec![insert_cells(&form, &columns, &answered, &respondent, now)],
            },
        }];
        // The row first, under the form's receipt, as the respondent or, for
        // an anonymous one, the form's owner; then the ledger, in its own
        // transaction.
        let viewer = match &respondent {
            Respondent::Member(user) => user.clone(),
            Respondent::Anonymous => owner_of(&form)?,
        };
        let results = self.write(&form, viewer, insert, &answered).await?;
        let row = inserted_row(&results)?;
        let member = match &respondent {
            Respondent::Member(user) => Some(user),
            Respondent::Anonymous => None,
        };
        let recorded = self
            .repository
            .record_submission(form.id, member, row, now)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, form_id = %form.id, row_id = %row, "a response's row was written but its ledger entry was not");
                repository_error(error)
            })?;
        let response = match recorded {
            RecordedResponse::Recorded(entry) => entry.id,
            RecordedResponse::AlreadySubmitted => {
                // A concurrent submission by the same person won the
                // one-per-person key; this row stays in the table.
                tracing::error!(form_id = %form.id, row_id = %row, "a duplicate response's row was written; the respondent already had an accepted response");
                return Err(FormError::AlreadyResponded);
            }
        };
        self.announce(form.id).await;
        self.emit(FormTopicEvent::ResponseSubmitted(
            FormResponseSubmittedMetadata {
                form_id: form.id,
                response_id: response,
                respondent: match respondent {
                    Respondent::Member(user) => Some(user),
                    Respondent::Anonymous => None,
                },
                row_id: Some(row),
                submitted_at: now,
            },
        ));
        Ok(SubmissionOutcome::Submitted {
            response,
            row,
            booking: unlocked_booking(&layout),
        })
    }

    pub(super) async fn edit(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        let now = self.now();
        let Respondent::Member(user) = receipt_respondent(receipt) else {
            return Err(FormError::SignInRequired);
        };
        let (form, _, table, layout) = self.open_for(receipt, now).await?;
        let entry = self
            .repository
            .response_of(form.id, &user)
            .await
            .map_err(repository_error)?
            .filter(|entry| entry.status == ResponseStatus::Submitted)
            .ok_or(FormError::NoResponse)?;
        let columns = question_columns(&table);
        gates_fit_table(&layout, &columns)?;
        let answered = match evaluate(&layout, &columns, &submission.answers)? {
            Evaluation::Passed(answered) => answered,
            // The saved response stays as it was.
            Evaluation::Stopped { section, message } => {
                return Ok(SubmissionOutcome::Stopped { section, message });
            }
        };
        let row = match self.held_row(&form, entry.row).await? {
            Some(row) => {
                self.rewrite_row(&form, &user, row, &answered).await?;
                self.repository
                    .touch_response(entry.id, now)
                    .await
                    .map_err(repository_error)?;
                row
            }
            None => {
                self.rewrite_lost_row(&form, &columns, &user, &entry, &answered, now)
                    .await?
            }
        };
        self.announce(form.id).await;
        Ok(SubmissionOutcome::Submitted {
            response: entry.id,
            row,
            booking: unlocked_booking(&layout),
        })
    }

    /// The entry's row, if it is still in the table.
    async fn held_row(&self, form: &Form, row: Option<RowId>) -> Result<Option<RowId>, FormError> {
        let Some(row) = row else {
            return Ok(None);
        };
        let cells = self
            .databases
            .cells_of_rows(
                internal_receipt::<ViewAccessLevel>(form.database_id),
                form.table_id,
                &[row],
            )
            .await
            .map_err(|error| match error {
                DatabaseError::NotFound => FormError::TableGone,
                other => database_error(other),
            })?;
        Ok(cells.contains_key(&row).then_some(row))
    }

    /// Write every question's answer to the row, clearing the unanswered.
    async fn rewrite_row(
        &self,
        form: &Form,
        user: &MacroUserIdStr<'static>,
        row: RowId,
        answered: &[AnsweredQuestion],
    ) -> Result<(), FormError> {
        let cells = answered
            .iter()
            .map(|question| CellWrite {
                column: question.column,
                value: question.value.clone().unwrap_or(CellValue::Clear),
            })
            .collect();
        self.write(
            form,
            user.clone(),
            vec![DatabaseOp::Rows {
                table: form.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange { row, cells }],
                    },
                },
            }],
            answered,
        )
        .await
        .map(|_| ())
    }

    /// The entry's row was deleted from the table: write a new one, stamped
    /// with the original submission time, and point the entry at it.
    async fn rewrite_lost_row(
        &self,
        form: &Form,
        columns: &HashMap<ColumnId, QuestionColumn>,
        user: &MacroUserIdStr<'static>,
        entry: &FormResponse,
        answered: &[AnsweredQuestion],
        now: DateTime<Utc>,
    ) -> Result<RowId, FormError> {
        let insert = vec![DatabaseOp::Rows {
            table: form.table_id,
            change: RowsChange::Insert {
                rows: vec![insert_cells(
                    form,
                    columns,
                    answered,
                    &Respondent::Member(user.clone()),
                    entry.submitted_at,
                )],
            },
        }];
        let results = self.write(form, user.clone(), insert, answered).await?;
        let row = inserted_row(&results)?;
        self.repository
            .repoint_response(entry.id, row, now)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, form_id = %form.id, row_id = %row, response_id = %entry.id, "a response's new row was written but its ledger entry was not repointed");
                repository_error(error)
            })?;
        Ok(row)
    }

    pub(super) async fn own_response(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<MyResponse, FormError> {
        let Respondent::Member(user) = receipt_respondent(receipt) else {
            return Err(FormError::SignInRequired);
        };
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let response = self
            .repository
            .response_of(form.id, &user)
            .await
            .map_err(repository_error)?
            .ok_or(FormError::NoResponse)?;
        let Some(row) = response.row else {
            return Ok(MyResponse {
                response,
                answers: vec![],
                booking: None,
            });
        };
        // A table gone, or its database in the trash, leaves the receipt
        // with no answers to show.
        let mut cells = match self
            .databases
            .cells_of_rows(
                internal_receipt::<ViewAccessLevel>(form.database_id),
                form.table_id,
                &[row],
            )
            .await
        {
            Ok(cells) => cells,
            Err(DatabaseError::NotFound) => {
                return Ok(MyResponse {
                    response,
                    answers: vec![],
                    booking: None,
                });
            }
            Err(other) => return Err(database_error(other)),
        };
        let table = self.table_of(&form).await?;
        let layout = self.refresh_layout(&form, table.as_ref()).await?.layout;
        let Some(cells) = cells.remove(&row) else {
            return Ok(MyResponse {
                response,
                answers: vec![],
                booking: None,
            });
        };
        let answers = answers_of(&layout, &cells);
        let passes = response.status == ResponseStatus::Submitted
            && match table {
                Some(table) => still_passes(&layout, &question_columns(&table), &answers),
                None => false,
            };
        Ok(MyResponse {
            response,
            answers,
            booking: passes.then(|| unlocked_booking(&layout)).flatten(),
        })
    }
}
