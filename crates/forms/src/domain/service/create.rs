//! Creating a form: over a new database whose one table holds only the
//! form's own columns, or over an existing table with a question per column.

use databases::domain::models::{CreateDatabase, OpBatch, TableDetail, Viewer};
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_event_broker::MacroEventBroker;
use models_databases::{ColumnChange, ColumnKind, DatabaseOp, NewColumn, TableChange};

use super::layout::{form_detail, question_columns};
use super::managed::{respondent_kind, submitted_kind};
use super::{
    FormsServiceImpl, database_error, internal_receipt, receipt_database_id, repository_error,
    validated_name,
};
use crate::domain::events::{Attribution, FormCreatedMetadata, FormTopicEvent};
use crate::domain::models::{
    Audience, ColumnId, DatabaseId, Form, FormAccess, FormDetail, FormError, FormId, FormLayout,
    FormSection, FormSectionId, FormStatus, QuestionLayout,
};
use crate::domain::ports::{
    Clock, CreateFormCommand, CreateSource, FormAccessDirectory, FormEventPublisher, FormsRepo,
};

/// The name a new database's table takes.
const RESPONSES_TABLE: &str = "Responses";
/// The date column each submission stamps.
const SUBMITTED_COLUMN: &str = "Submitted";
/// The person column each signed-in submission names its respondent in.
const RESPONDENT_COLUMN: &str = "Respondent";

/// A column the form writes itself: one the table already has, reused, or
/// one to create.
enum ManagedColumn {
    Existing(ColumnId),
    New { id: ColumnId, name: String },
}

impl ManagedColumn {
    fn id(&self) -> ColumnId {
        match self {
            ManagedColumn::Existing(id) | ManagedColumn::New { id, .. } => *id,
        }
    }
}

/// Find the table's column named `base` (or `base 2`, `base 3`, … when an
/// earlier name is taken by a column of another type) of `kind`, so forms
/// over one table share their managed columns; otherwise the first free
/// such name for a new one.
fn managed_column(table: &TableDetail, base: &str, kind: ColumnKind) -> ManagedColumn {
    let columns = question_columns(table);
    let named = |name: &str| {
        table
            .columns
            .iter()
            .find(|column| column.name().trim().to_lowercase() == name.to_lowercase())
    };
    let mut ordinal = 1;
    loop {
        let name = if ordinal == 1 {
            base.to_string()
        } else {
            format!("{base} {ordinal}")
        };
        match named(&name) {
            None => {
                return ManagedColumn::New {
                    id: ColumnId::new(),
                    name,
                };
            }
            Some(column)
                if columns
                    .get(&column.column.id)
                    .is_some_and(|facts| facts.kind == kind) =>
            {
                return ManagedColumn::Existing(column.column.id);
            }
            Some(_) => ordinal += 1,
        }
    }
}

/// The op creating a managed column, when it is new.
fn create_op(table: &TableDetail, column: &ManagedColumn, kind: ColumnKind) -> Option<DatabaseOp> {
    let ManagedColumn::New { id, name } = column else {
        return None;
    };
    Some(DatabaseOp::Column {
        table: table.table.id,
        column: *id,
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: name.clone(),
                kind,
                options: vec![],
                infer_type: false,
            },
            after: None,
        },
    })
}

impl<Repository, Databases, Access, Events, Now, Broker>
    FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    pub(super) async fn create(
        &self,
        creator: Viewer,
        command: CreateFormCommand,
    ) -> Result<FormDetail, FormError> {
        let name = validated_name(&command.name)?;
        match command.source {
            CreateSource::NewDatabase => self.create_over_new_database(creator, name).await,
            CreateSource::Table { receipt, table_id } => {
                self.create_over_table(creator, name, receipt, table_id)
                    .await
            }
        }
    }

    /// A new database for the creator, its first table renamed "Responses"
    /// and holding only the managed columns, and a form with one empty
    /// section over it. Nothing is left behind if any step fails.
    async fn create_over_new_database(
        &self,
        creator: Viewer,
        name: String,
    ) -> Result<FormDetail, FormError> {
        let database = self
            .databases
            .create_database(CreateDatabase {
                name: name.clone(),
                owner_id: creator.user_id.clone(),
                acting_bot: creator.acting_bot,
            })
            .await
            .map_err(database_error)?;
        match self
            .attach_to_new_database(&creator, name, database.id)
            .await
        {
            Ok(detail) => Ok(detail),
            Err(error) => {
                self.remove_new_database(database.id).await;
                Err(error)
            }
        }
    }

    async fn attach_to_new_database(
        &self,
        creator: &Viewer,
        name: String,
        database_id: DatabaseId,
    ) -> Result<FormDetail, FormError> {
        let detail = self
            .databases
            .get_database(internal_receipt::<ViewAccessLevel>(database_id))
            .await
            .map_err(database_error)?;
        let table = detail.tables.into_iter().next().ok_or_else(|| {
            FormError::Repository(rootcause::report!("a new database has no table"))
        })?;
        let submitted = ManagedColumn::New {
            id: ColumnId::new(),
            name: SUBMITTED_COLUMN.to_string(),
        };
        let respondent = ManagedColumn::New {
            id: ColumnId::new(),
            name: RESPONDENT_COLUMN.to_string(),
        };
        let mut ops = vec![DatabaseOp::Table {
            table: table.table.id,
            change: TableChange::Rename {
                name: RESPONSES_TABLE.to_string(),
                previous_name: Some(table.table.name.clone()),
            },
        }];
        ops.extend(
            [
                create_op(&table, &submitted, submitted_kind()),
                create_op(&table, &respondent, respondent_kind()),
            ]
            .into_iter()
            .flatten(),
        );
        // The starter title column has no place on a form: the managed
        // columns go in first, so the table is never left without one.
        ops.extend(table.columns.iter().map(|column| DatabaseOp::Column {
            table: table.table.id,
            column: column.column.id,
            change: ColumnChange::Delete,
        }));
        self.databases
            .apply_ops(
                internal_receipt::<EditAccessLevel>(database_id),
                creator.clone(),
                OpBatch::from(ops),
            )
            .await
            .map_err(database_error)?;
        let layout = FormLayout {
            sections: vec![FormSection::Questions {
                id: FormSectionId::new(),
                title: String::new(),
                description: String::new(),
                questions: vec![],
            }],
        };
        self.store_new_form(
            creator,
            name,
            (submitted.id(), respondent.id()),
            layout,
            &table,
        )
        .await
    }

    /// Undo a database this request created, logging a failure: the form
    /// was not created, so nothing points at it.
    async fn remove_new_database(&self, database_id: DatabaseId) {
        if let Err(error) = self
            .databases
            .delete_database_permanently(internal_receipt::<OwnerAccessLevel>(database_id))
            .await
        {
            tracing::error!(error = ?error, %database_id, "failed to remove the database of a form that was not created");
        }
    }

    /// A form over a table of a database the creator owns: the managed
    /// columns found or created, then one section asking every other column.
    async fn create_over_table(
        &self,
        creator: Viewer,
        name: String,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        table_id: models_databases::TableId,
    ) -> Result<FormDetail, FormError> {
        // The receipt must be for a database; the table is looked up in it.
        receipt_database_id(&receipt)?;
        let view = receipt
            .clone()
            .try_into_requirement::<ViewAccessLevel>()
            .map_err(|_| FormError::NotFound)?;
        let detail = self
            .databases
            .get_database(view)
            .await
            .map_err(|error| match error {
                databases::domain::models::DatabaseError::NotFound => FormError::NotFound,
                other => database_error(other),
            })?;
        let table = detail
            .tables
            .into_iter()
            .find(|table| table.table.id == table_id)
            .ok_or(FormError::NotFound)?;
        let submitted = managed_column(&table, SUBMITTED_COLUMN, submitted_kind());
        let respondent = managed_column(&table, RESPONDENT_COLUMN, respondent_kind());
        let ops: Vec<DatabaseOp> = [
            create_op(&table, &submitted, submitted_kind()),
            create_op(&table, &respondent, respondent_kind()),
        ]
        .into_iter()
        .flatten()
        .collect();
        if !ops.is_empty() {
            // Owner holds Edit, so the creator's own receipt writes the
            // managed columns and the journal names them.
            let edit = receipt
                .try_into_requirement::<EditAccessLevel>()
                .map_err(|_| FormError::NotFound)?;
            self.databases
                .apply_ops(edit, creator.clone(), OpBatch::from(ops))
                .await
                .map_err(database_error)?;
        }
        let managed = [submitted.id(), respondent.id()];
        let askable = question_columns(&table);
        let questions = table
            .columns
            .iter()
            .filter(|column| !managed.contains(&column.column.id))
            .filter(|column| askable.contains_key(&column.column.id))
            .map(|column| QuestionLayout {
                id: crate::domain::models::FormQuestionId::new(),
                column: column.column.id,
                help_text: String::new(),
                required: false,
                widget: None,
            })
            .collect();
        let layout = FormLayout {
            sections: vec![FormSection::Questions {
                id: FormSectionId::new(),
                title: String::new(),
                description: String::new(),
                questions,
            }],
        };
        self.store_new_form(
            &creator,
            name,
            (submitted.id(), respondent.id()),
            layout,
            &table,
        )
        .await
    }

    /// Store a new form over `table`, owned by its creator, writing its two
    /// managed columns.
    async fn store_new_form(
        &self,
        creator: &Viewer,
        name: String,
        (submitted, respondent): (ColumnId, ColumnId),
        layout: FormLayout,
        table: &TableDetail,
    ) -> Result<FormDetail, FormError> {
        let now = self.now();
        let database_id = table.table.database_id;
        let form = Form {
            id: FormId::new(),
            name,
            description: String::new(),
            owner_id: creator.user_id.to_string(),
            database_id,
            table_id: table.table.id,
            submitted_column_id: Some(submitted),
            respondent_column_id: Some(respondent),
            audience: Audience::Members,
            tally_visible: false,
            status: FormStatus::Open,
            closes_at: None,
            confirmation_message: String::new(),
            created_at: now,
            updated_at: now,
        };
        self.repository
            .create_form(&form, &layout)
            .await
            .map_err(repository_error)?;
        self.emit(FormTopicEvent::Created(FormCreatedMetadata {
            form_id: form.id,
            database_id,
            owner: creator.user_id.clone(),
            name: form.name.clone(),
            created_at: now,
            attribution: Attribution::acting(creator.user_id.clone(), creator.acting_bot),
        }));
        Ok(form_detail(form, FormAccess::Owner, layout, Some(table)))
    }
}
