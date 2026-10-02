//! Why a schema or sharing change was refused, each case its own variant so
//! callers branch on the case and users read its message.

use std::fmt;

use super::PropertyDefinitionId;

/// A refused schema change. The messages are shown to users and agents.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SchemaError {
    /// A database, table, column or view name is blank.
    #[error("name must not be empty")]
    EmptyName,
    /// A name is longer than any may be.
    #[error("name must be at most {max} characters")]
    NameTooLong {
        /// The longest accepted name.
        max: usize,
    },
    /// An option label is blank.
    #[error("an option label must not be empty")]
    EmptyOptionLabel,
    /// An option label is longer than any may be.
    #[error("an option label must be at most {max} characters")]
    OptionLabelTooLong {
        /// The longest accepted label.
        max: usize,
    },
    /// A numeric select's option label is not a number.
    #[error("`{label}` is not a number; the options of a numeric select column must be numbers")]
    OptionNotNumber {
        /// The label given.
        label: String,
    },
    /// Options were given for a column type that takes none.
    #[error("options are only valid on select, select_number, and tag columns")]
    OptionsOnPlainColumn,
    /// Options were added to a column that holds none.
    #[error("only select, select_number, and tag columns have options")]
    ColumnTakesNoOptions,
    /// The options of a property shared beyond the database may not change.
    #[error(
        "\"{column}\" is a property shared beyond this database, and you may not change its options"
    )]
    SharedOptions {
        /// The column's name.
        column: String,
    },
    /// Another table of the database has the name.
    #[error("a table named `{name}` already exists in this database")]
    TableNameTaken {
        /// The name.
        name: String,
    },
    /// The table's name moved, or another table took it, while renaming.
    #[error("the table name changed or is already in use. Reopen Rename table and try again")]
    TableRenameConflict,
    /// A table order does not name every table once.
    #[error("The table order must include every table of this database exactly once.")]
    IncompleteTableOrder,
    /// The table is its database's last.
    #[error(
        "This is the database's only table, and a database keeps at least one. Add another table \
         first, or delete the whole database instead."
    )]
    LastTable,
    /// Another table's relation points at the table being deleted.
    #[error(
        "Column `{column}` of table `{source_table}` relates to rows of `{table}`. Delete that \
         column first."
    )]
    TableIsRelated {
        /// The relation column.
        column: String,
        /// The table holding it.
        source_table: String,
        /// The table being deleted.
        table: String,
    },
    /// A relation's target database is not one the viewer can reach.
    #[error("link target database is not accessible")]
    LinkDatabaseInaccessible,
    /// A relation's target table is not in its database.
    #[error("link target table does not exist")]
    LinkTableMissing,
    /// Another column of the table has the name.
    #[error("a column named `{name}` already exists on this table")]
    ColumnNameTaken {
        /// The name.
        name: String,
    },
    /// The property is already bound on the table.
    #[error("that property is already a column of this table")]
    DefinitionAlreadyBound,
    /// The property does not exist or is not the viewer's to bind.
    #[error("property definition {0} not found")]
    DefinitionNotFound(PropertyDefinitionId),
    /// The column's label moved since the client read it.
    #[error("This column was renamed elsewhere. Cancel and rename it again.")]
    ColumnRenamedElsewhere,
    /// Another column of the table has the label.
    #[error("A column with this name already exists. Choose another name.")]
    ColumnLabelTaken,
    /// The table moved while the column was renamed.
    #[error("The table changed while renaming. Try again.")]
    TableChangedWhileRenaming,
    /// A new column lists an option label twice.
    #[error("`{label}` is listed twice; each option of a column needs its own label")]
    OptionListedTwice {
        /// The label.
        label: String,
    },
    /// A type change came after the batch wrote the column's table or
    /// options, so the values it would convert are not the stored ones.
    #[error(
        "A type change converts the values the column holds when the request starts; change the \
         type before this request writes the table's rows or the column's options."
    )]
    RetypeAfterWrites,
    /// A column order does not name every column once.
    #[error("The column order must include every column exactly once.")]
    IncompleteColumnOrder,
    /// A board groups by the column being removed.
    #[error(
        "The board \"{board}\" groups its cards by this column; delete the board or group it by \
         another column before removing it."
    )]
    BoardGroupsByRemovedColumn {
        /// The board's name.
        board: String,
    },
    /// A board groups by the column being retyped.
    #[error(
        "The board \"{board}\" groups its cards by this column; delete the board or group it by \
         another column before changing its type."
    )]
    BoardGroupsByRetypedColumn {
        /// The board's name.
        board: String,
    },
    /// A relation was asked for with a type other than entity.
    #[error("A relation column's type is entity.")]
    RelationNotEntity,
    /// The requested type is not one a column can have.
    #[error("Choose a supported column type and its reference target.")]
    UnsupportedColumnType,
    /// A relation's target table is not one the viewer can reach.
    #[error("The related table is not accessible.")]
    RelatedTableInaccessible,
    /// The table has more rows than a type change converts at once.
    #[error("This table is too large to validate a type change in one operation.")]
    TooManyRowsToRetype,
    /// No value of the column converts to the type; the cast rule's reason.
    #[error("{0}")]
    NeverCasts(&'static str),
    /// Some values do not convert, and the change did not ask to clear them.
    #[error("{0}")]
    Misfits(ConversionRefusal),
    /// Only a new plain text column infers its type.
    #[error("Only a new plain text column can infer its first value's type.")]
    InferenceNeedsPlainText,
    /// An inferred type is text, a number, or a typed reference.
    #[error("Choose text, number, or an entity with its specific type.")]
    UnsupportedInferredType,
    /// The column is not a new empty text column any more.
    #[error("Only a new empty text column can infer its first value's type.")]
    InferenceNeedsEmptyText,
    /// A value landed, or the table moved, before the type settled.
    #[error("The column already contains values or the table changed. Refresh and try again.")]
    InferenceRaced,
    /// An import is wider or longer than any may be.
    #[error("Import up to 100 columns and 10,000 rows.")]
    ImportTooWide,
    /// Two import headers name the same column.
    #[error("Each column needs a distinct name.")]
    DuplicateImportColumn,
    /// An import row has another width than the header.
    #[error("Each row must match the CSV header.")]
    RaggedImportRow,
    /// An import value holds a null character.
    #[error("The CSV contains null characters. Remove them before importing.")]
    NullCharacterInImport,
    /// The import is larger than any may be.
    #[error("The import is too large.")]
    ImportTooLarge,
    /// The import's request key was used for other contents.
    #[error("This import request changed. Start a new import.")]
    ImportRequestChanged,
    /// Another table of the database has the import's name.
    #[error("A table with this name already exists. Choose another name.")]
    ImportNameTaken,
}

/// A refused sharing change.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SharingError {
    /// Share links are not supported for databases.
    #[error("Databases cannot be shared by link yet.")]
    LinkShare,
    /// Team shares are not supported for databases.
    #[error("Databases cannot be shared with a team yet.")]
    TeamShare,
    /// A request changes more channel grants than any may.
    #[error("Share with at most {max} channels at a time.")]
    TooManyChannels {
        /// The most grants one request may change.
        max: usize,
    },
    /// A channel grant is malformed, repeated, or grants ownership.
    #[error("Choose a channel and view, comment, or edit access.")]
    InvalidChannelGrant,
}

/// Why one cell's value does not fit a column's new type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Misfit {
    /// The value has no text form.
    NotText,
    /// The value is not a number.
    NotNumber,
    /// The value is not a date.
    NotDate,
    /// The value is not true or false.
    NotCheckbox,
    /// The value is not a complete URL.
    NotUrl,
    /// The value cannot be an option label.
    NotOption,
    /// The label differs from another only in case.
    OptionInOtherCase,
    /// The reference points at another kind of item.
    OtherReference,
    /// A single-valued type got a cell with several values.
    SeveralValues,
}

impl Misfit {
    /// What is counted: values, or cells for a cell with several values.
    fn noun(self, one: bool) -> &'static str {
        match (self, one) {
            (Misfit::SeveralValues, true) => "cell",
            (Misfit::SeveralValues, false) => "cells",
            (_, true) => "value",
            (_, false) => "values",
        }
    }

    /// What is wrong with them.
    fn predicate(self, one: bool) -> &'static str {
        let (singular, plural) = match self {
            Misfit::NotText => ("can't be written as text", "can't be written as text"),
            Misfit::NotNumber => ("isn't a number", "aren't numbers"),
            Misfit::NotDate => ("isn't a date", "aren't dates"),
            Misfit::NotCheckbox => ("isn't true or false", "aren't true or false"),
            Misfit::NotUrl => ("isn't a complete URL", "aren't complete URLs"),
            Misfit::NotOption => ("can't be an option", "can't be options"),
            Misfit::OptionInOtherCase => (
                "differs from another only in capitalization",
                "differ from others only in capitalization",
            ),
            Misfit::OtherReference => (
                "points at a different kind of item",
                "point at a different kind of item",
            ),
            Misfit::SeveralValues => ("has more than one value", "have more than one value"),
        };
        if one { singular } else { plural }
    }
}

/// The cells of one kind of misfit: how many, and a few quoted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MisfitGroup {
    /// What is wrong with them.
    pub misfit: Misfit,
    /// How many cells.
    pub count: usize,
    /// The first few values, as text.
    pub examples: Vec<String>,
}

impl MisfitGroup {
    /// `3 values aren't numbers`.
    pub fn summary(&self) -> String {
        let one = self.count == 1;
        format!(
            "{} {} {}",
            self.count,
            self.misfit.noun(one),
            self.misfit.predicate(one)
        )
    }
}

/// A type change refused because some of a column's values do not fit,
/// naming the column, the misfits, and the way forward.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversionRefusal {
    /// The column's name.
    pub column: String,
    /// The misfits by kind, in the order each kind first came; never empty.
    pub groups: Vec<MisfitGroup>,
}

impl fmt::Display for ConversionRefusal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for group in &self.groups {
            let one = group.count == 1;
            let quoted: Vec<String> = group
                .examples
                .iter()
                .map(|example| format!("'{example}'"))
                .collect();
            write!(
                formatter,
                "{} {} in \"{}\" {}: {}. ",
                group.count,
                group.misfit.noun(one),
                self.column,
                group.misfit.predicate(one),
                quoted.join(", ")
            )?;
        }
        let one = self.groups.iter().map(|group| group.count).sum::<usize>() == 1;
        formatter.write_str(if one {
            "Fix it, or add a column of the new type for the values that convert."
        } else {
            "Fix them, or add a column of the new type for the values that convert."
        })
    }
}
