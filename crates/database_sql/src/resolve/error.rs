//! Resolution failures, as typed values the browser reads by `kind` and the
//! `Display` text agents correct their statement from; tests assert both.

use std::fmt;

/// Why a statement could not be bound to the catalog.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, serde::Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResolveError {
    /// No table has the name.
    UnknownTable {
        /// The name as written, qualified if it was.
        name: String,
        /// The closest existing name, if one is close.
        suggestion: Option<String>,
    },
    /// A bare table name matches tables in several databases.
    AmbiguousTable {
        /// The bare name.
        name: String,
        /// The databases that have a table of that name.
        databases: Vec<String>,
    },
    /// The table has no such column.
    UnknownColumn {
        /// The name as written.
        name: String,
        /// The qualified table name.
        table: String,
        /// The closest existing column name, if one is close.
        suggestion: Option<String>,
    },
    /// A select column has no option with that label.
    UnknownOption {
        /// The column.
        column: String,
        /// The label as written.
        label: String,
        /// Every option label the column has.
        options: Vec<String>,
    },
    /// The operator is not defined for the column's type.
    OperatorNotSupported {
        /// The column.
        column: String,
        /// The operator as written.
        op: &'static str,
        /// What the column's type does support.
        supported: &'static str,
    },
    /// `HAS` on a column that holds one value.
    HasOnSingleValued {
        /// The column.
        column: String,
    },
    /// `=`/`IN` on a column that holds several values.
    EqualityOnMultiValued {
        /// The column.
        column: String,
    },
    /// The literal is the wrong type for the column.
    TypeMismatch {
        /// The column.
        column: String,
        /// What the column holds.
        expected: &'static str,
        /// What to write instead.
        hint: &'static str,
    },
    /// `= NULL` or `!= NULL`.
    CompareToNull {
        /// The column.
        column: String,
    },
    /// The aggregate cannot apply to the column's type.
    AggregateNotSupported {
        /// The aggregate.
        func: &'static str,
        /// The column.
        column: String,
        /// What the column holds.
        #[serde(rename = "columnKind")]
        kind: &'static str,
    },
    /// A plain column in a select list that aggregates, without a `GROUP BY`
    /// on that column.
    ColumnNotGrouped {
        /// The column.
        column: String,
        /// Whether a `GROUP BY` is present at all.
        grouped: bool,
    },
    /// `ORDER BY n` past the end of the select list.
    OrderPositionOutOfRange {
        /// The position as written.
        position: u32,
        /// How many items the select list has.
        #[specta(type = u32)]
        items: usize,
    },
    /// `ORDER BY agg(...)` where the aggregate is not in the select list.
    OrderAggregateNotSelected {
        /// The aggregate as written.
        agg: String,
    },
    /// `ORDER BY column` on a grouped query where the column is neither the
    /// group column nor aggregated.
    OrderColumnNotGrouped {
        /// The column.
        column: String,
    },
    /// `WHERE row_id = …` with something that is not a row id.
    RowIdNotAnId {
        /// The value as written.
        written: String,
    },
    /// A list written to a column that holds one value.
    ListOnSingleValued {
        /// The column.
        column: String,
        /// How many values the list had.
        #[specta(type = u32)]
        count: usize,
    },
    /// A list where a single value is compared.
    ListInComparison {
        /// The column.
        column: String,
    },
    /// A column named twice in an `INSERT` column list or `UPDATE`.
    #[serde(rename = "duplicateInsertColumn")]
    DuplicateColumn {
        /// The column.
        column: String,
    },
    /// Two tables of a `SELECT` share an alias.
    DuplicateAlias {
        /// The alias.
        alias: String,
        /// The table already using it.
        table: String,
    },
    /// `alias.column` names an alias the query does not have.
    UnknownAlias {
        /// The alias as written.
        alias: String,
        /// The column as written.
        column: String,
        /// Every relation, as `database.table as alias`.
        relations: Vec<String>,
    },
    /// A bare column name that several relations have.
    AmbiguousColumn {
        /// The name.
        name: String,
        /// The `alias.column` spellings that would pick one.
        qualified: Vec<String>,
    },
    /// An `ON` equality that does not relate the joined table to an
    /// earlier one.
    JoinNotAcrossTables {
        /// The joined table's alias.
        alias: String,
        /// The left column as written.
        left: String,
        /// The right column as written.
        right: String,
    },
    /// A type change the cast rule never allows while the column holds
    /// values.
    CastNever {
        /// The column.
        column: String,
        /// The type asked for, as SQL spells it.
        to: String,
        /// Why no value converts.
        reason: &'static str,
    },
    /// A write to a table nobody writes, such as `macro.people`.
    ReadOnlyTable {
        /// The qualified table name.
        table: String,
    },
    /// `SET column = other` where the other column holds a different kind of
    /// value.
    CopyKindMismatch {
        /// The column set.
        column: String,
        /// Its kind.
        column_kind: &'static str,
        /// The column copied.
        copied: String,
        /// Its kind.
        copied_kind: &'static str,
    },
    /// An `ON` equality between columns of different kinds.
    JoinKindMismatch {
        /// The earlier table's column.
        left: String,
        /// Its kind.
        left_kind: &'static str,
        /// The joined table's column.
        right: String,
        /// Its kind.
        right_kind: &'static str,
    },
}

impl fmt::Display for ResolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownTable { name, suggestion } => {
                write!(f, "unknown table {name}")?;
                if let Some(suggestion) = suggestion {
                    write!(f, " — did you mean {suggestion}?")?;
                }
                Ok(())
            }
            Self::AmbiguousTable { name, databases } => {
                let qualified: Vec<String> = databases
                    .iter()
                    .map(|database| format!("{database}.{name}"))
                    .collect();
                write!(
                    f,
                    "table \"{name}\" exists in {} — qualify it as {}",
                    databases.join(" and "),
                    qualified.join(" or ")
                )
            }
            Self::UnknownColumn {
                name,
                table,
                suggestion,
            } => {
                write!(f, "unknown column \"{name}\" in {table}")?;
                if let Some(suggestion) = suggestion {
                    write!(f, " — did you mean \"{suggestion}\"?")?;
                }
                Ok(())
            }
            Self::UnknownOption {
                column,
                label,
                options,
            } => write!(
                f,
                "\"{label}\" is not an option of \"{column}\" ({})",
                options.join(", ")
            ),
            Self::OperatorNotSupported {
                column,
                op,
                supported,
            } => write!(f, "cannot use {op} on \"{column}\": {supported}"),
            Self::HasOnSingleValued { column } => {
                write!(f, "\"{column}\" holds one value; use = instead of HAS")
            }
            Self::EqualityOnMultiValued { column } => {
                write!(f, "\"{column}\" holds several values; use HAS instead of =")
            }
            Self::TypeMismatch {
                column,
                expected,
                hint,
            } => {
                let article = if expected.starts_with(['a', 'e', 'i', 'o', 'u']) {
                    "an"
                } else {
                    "a"
                };
                write!(f, "\"{column}\" is {article} {expected} column; {hint}")
            }
            Self::CompareToNull { column } => {
                write!(
                    f,
                    "use \"{column}\" IS NULL or IS NOT NULL to test for an empty cell"
                )
            }
            Self::AggregateNotSupported { func, column, kind } => {
                write!(
                    f,
                    "{func} cannot apply to \"{column}\": it is a {kind} column"
                )
            }
            Self::ColumnNotGrouped { column, grouped } => {
                if *grouped {
                    write!(
                        f,
                        "\"{column}\" must appear in GROUP BY or inside an aggregate"
                    )
                } else {
                    write!(
                        f,
                        "\"{column}\" must appear in GROUP BY when the select list has aggregates"
                    )
                }
            }
            Self::OrderPositionOutOfRange { position, items } => write!(
                f,
                "ORDER BY {position} is out of range; the select list has {items} item{}",
                if *items == 1 { "" } else { "s" }
            ),
            Self::OrderAggregateNotSelected { agg } => {
                write!(f, "ORDER BY {agg} must also appear in the select list")
            }
            Self::OrderColumnNotGrouped { column } => write!(
                f,
                "cannot ORDER BY \"{column}\": it is neither the GROUP BY column nor aggregated"
            ),
            Self::RowIdNotAnId { written } => write!(
                f,
                "'{written}' is not a row id; row ids are the UUIDs a SELECT returns"
            ),
            Self::ListOnSingleValued { column, count } => write!(
                f,
                "\"{column}\" holds one value; a list of {count} was given"
            ),
            Self::ListInComparison { column } => write!(
                f,
                "compare \"{column}\" to one value; lists are for INSERT and UPDATE"
            ),
            Self::DuplicateColumn { column } => {
                write!(f, "\"{column}\" is listed twice")
            }
            Self::DuplicateAlias { alias, table } => write!(
                f,
                "\"{alias}\" already names {table}; give the other table an alias, like JOIN crm.people p"
            ),
            Self::UnknownAlias {
                alias,
                column,
                relations,
            } => write!(
                f,
                "unknown table \"{alias}\" in {alias}.{column} — the query reads {}",
                relations.join(" and ")
            ),
            Self::AmbiguousColumn { name, qualified } => write!(
                f,
                "\"{name}\" is ambiguous — qualify it as {}",
                qualified.join(" or ")
            ),
            Self::JoinNotAcrossTables { alias, left, right } => write!(
                f,
                "ON {left} = {right} must compare a column of {alias} with a column of an earlier table"
            ),
            Self::CastNever { column, to, reason } => write!(
                f,
                "\"{column}\" can't become {to}: {reason} Add a new column instead."
            ),
            Self::ReadOnlyTable { table } => write!(f, "{table} is read-only"),
            Self::CopyKindMismatch {
                column,
                column_kind,
                copied,
                copied_kind,
            } => write!(
                f,
                "\"{column}\" ({column_kind}) can't be set from \"{copied}\" ({copied_kind}): a column copies only a column of the same kind"
            ),
            Self::JoinKindMismatch {
                left,
                left_kind,
                right,
                right_kind,
            } => write!(
                f,
                "cannot join {left} ({left_kind}) to {right} ({right_kind}): join columns must hold the same kind of value"
            ),
        }
    }
}
