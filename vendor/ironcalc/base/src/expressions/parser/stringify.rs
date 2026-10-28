use super::{super::utils::quote_name, Node, Reference};
use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::parser::move_formula::to_string_array_node;
use crate::expressions::parser::static_analysis::remove_redundant_implicit_intersection;
use crate::expressions::token::{OpSum, OpUnary};
use crate::functions::Function;
use crate::language::{get_language, Language};
use crate::locale::{get_locale, Locale};
use crate::{expressions::types::CellReferenceRC, number_format::to_excel_precision_str};

pub enum DisplaceData {
    Column {
        sheet: u32,
        column: i32,
        delta: i32,
    },
    Row {
        sheet: u32,
        row: i32,
        delta: i32,
    },
    CellHorizontal {
        sheet: u32,
        row: i32,
        column: i32,
        delta: i32,
    },
    CellVertical {
        sheet: u32,
        row: i32,
        column: i32,
        delta: i32,
    },
    RowMove {
        sheet: u32,
        row: i32,
        delta: i32,
    },
    ColumnMove {
        sheet: u32,
        column: i32,
        delta: i32,
    },
    None,
}

/// This is the internal mode in IronCalc
/// Formulas internally are stored in R1C1 format, the locale and language are always "en"
pub fn to_rc_format(node: &Node) -> String {
    #[allow(clippy::expect_used)]
    let locale = get_locale("en").expect("");
    #[allow(clippy::expect_used)]
    let language = get_language("en").expect("");
    stringify(node, None, &DisplaceData::None, false, locale, language)
}

pub fn to_english_string(node: &Node, context: &CellReferenceRC) -> String {
    #[allow(clippy::expect_used)]
    let locale = get_locale("en").expect("");
    #[allow(clippy::expect_used)]
    let language = get_language("en").expect("");
    stringify(
        node,
        Some(context),
        &DisplaceData::None,
        false,
        locale,
        language,
    )
}

/// This is the mode used to display the formula in the UI
pub fn to_localized_string(
    node: &Node,
    context: &CellReferenceRC,
    locale: &Locale,
    language: &Language,
) -> String {
    stringify(
        node,
        Some(context),
        &DisplaceData::None,
        false,
        locale,
        language,
    )
}

/// This is the mode used to export the formula to Excel
/// Internally the locale and language are always "en"
pub fn to_excel_string(node: &Node, context: &CellReferenceRC) -> String {
    excel_string(node, context, false)
}

/// Like [`to_excel_string`], for the formula of an array, CSE or dynamic.
///
/// No implicit intersection is added to the formula of an array when it is
/// read, by Excel or by the import, so none of its `@` is redundant: they are
/// all written, as `_xlfn.SINGLE`.
pub fn to_excel_array_formula_string(node: &Node, context: &CellReferenceRC) -> String {
    excel_string(node, context, true)
}

fn excel_string(node: &Node, context: &CellReferenceRC, is_array_formula: bool) -> String {
    #[allow(clippy::expect_used)]
    let locale = get_locale("en").expect("");
    #[allow(clippy::expect_used)]
    let language = get_language("en").expect("");
    // The internal representation stores every implicit intersection as `@`,
    // without the `automatic` flag. Drop the operators that Excel would re-insert
    // automatically on import; the rest are kept as `_xlfn.SINGLE` while
    // stringifying. See `remove_redundant_implicit_intersection`.
    let mut node = node.clone();
    if !is_array_formula {
        remove_redundant_implicit_intersection(&mut node, true);
    }
    prefix_bound_variables(&mut node, &mut Vec::new());
    stringify(
        &node,
        Some(context),
        &DisplaceData::None,
        true,
        locale,
        language,
    )
}

/// Excel stores LAMBDA parameters and LET variables with an `_xlpm.` prefix,
/// both at the declaration and at every use site:
/// `LET(x,1,x*2)` is written as `_xlfn.LET(_xlpm.x,1,_xlpm.x*2)`.
/// Internally IronCalc keeps the bare names, so before exporting we walk the
/// tree tracking which names are bound by an enclosing LAMBDA/LET and rename
/// those occurrences. Unbound names (e.g. a defined name that only resolves at
/// evaluation time) are left alone. Matching is case-sensitive, mirroring
/// evaluation (see `assign_variable_ids`).
fn prefix_bound_variables(node: &mut Node, bound: &mut Vec<String>) {
    match node {
        Node::NamedVariableKind { name, .. } => {
            if bound.iter().any(|n| n == name) {
                *name = format!("_xlpm.{name}");
            }
        }
        // A bound lambda used as a function: `LET(f,LAMBDA(a,a*a),f(2))`
        Node::NamedFunctionKind { name, args, .. } => {
            if bound.iter().any(|n| n == name) {
                *name = format!("_xlpm.{name}");
            }
            for arg in args {
                prefix_bound_variables(arg, bound);
            }
        }
        Node::LambdaDefKind { parameters, body } => {
            let depth = bound.len();
            for parameter in parameters.iter() {
                bound.push(parameter.name.clone());
            }
            prefix_bound_variables(body, bound);
            bound.truncate(depth);
        }
        Node::FunctionKind {
            kind: Function::Let,
            args,
        } if args.len() >= 3 && args.len() % 2 == 1 => {
            // LET(name1, value1, [name2, value2, ...], body): each name is in
            // scope from its own value expression onwards.
            let depth = bound.len();
            let pair_count = (args.len() - 1) / 2;
            for i in 0..pair_count {
                if let Node::NamedVariableKind { name, .. } = &mut args[2 * i] {
                    bound.push(name.clone());
                    *name = format!("_xlpm.{name}");
                }
                prefix_bound_variables(&mut args[2 * i + 1], bound);
            }
            prefix_bound_variables(&mut args[2 * pair_count], bound);
            bound.truncate(depth);
        }
        Node::FunctionKind { args, .. } => {
            for arg in args {
                prefix_bound_variables(arg, bound);
            }
        }
        Node::LambdaCallKind { lambda, args } => {
            prefix_bound_variables(lambda, bound);
            for arg in args {
                prefix_bound_variables(arg, bound);
            }
        }
        Node::OpRangeKind { left, right }
        | Node::OpConcatenateKind { left, right }
        | Node::OpSumKind { left, right, .. }
        | Node::OpProductKind { left, right, .. }
        | Node::OpPowerKind { left, right }
        | Node::CompareKind { left, right, .. } => {
            prefix_bound_variables(left, bound);
            prefix_bound_variables(right, bound);
        }
        Node::UnaryKind { right, .. } => prefix_bound_variables(right, bound),
        Node::ImplicitIntersection { child, .. } | Node::SpillRangeOperator { child } => {
            prefix_bound_variables(child, bound)
        }
        Node::BooleanKind(_)
        | Node::NumberKind(_)
        | Node::StringKind(_)
        | Node::ReferenceKind { .. }
        | Node::RangeKind { .. }
        | Node::WrongReferenceKind { .. }
        | Node::WrongRangeKind { .. }
        | Node::ArrayKind(_)
        | Node::DefinedNameKind(_)
        | Node::TableNameKind(_)
        | Node::ErrorKind(_)
        | Node::ParseErrorKind { .. }
        | Node::EmptyArgKind => {}
    }
}

pub fn to_string_displaced(
    node: &Node,
    context: &CellReferenceRC,
    displace_data: &DisplaceData,
    locale: &Locale,
    language: &Language,
) -> String {
    stringify(node, Some(context), displace_data, false, locale, language)
}

/// Converts a local reference to a string applying some displacement if needed.
/// It uses A1 style if context is not None. If context is None it uses R1C1 style
/// If full_row is true then the row details will be omitted in the A1 case
/// If full_column is true then column details will be omitted.
pub(crate) fn stringify_reference(
    context: Option<&CellReferenceRC>,
    displace_data: &DisplaceData,
    reference: &Reference,
    full_row: bool,
    full_column: bool,
) -> String {
    let sheet_name = reference.sheet_name;
    let sheet_index = reference.sheet_index;
    let absolute_row = reference.absolute_row;
    let absolute_column = reference.absolute_column;
    let row = reference.row;
    let column = reference.column;
    match context {
        Some(context) => {
            let mut row = if absolute_row { row } else { row + context.row };
            let mut column = if absolute_column {
                column
            } else {
                column + context.column
            };
            match displace_data {
                DisplaceData::Row {
                    sheet,
                    row: displace_row,
                    delta,
                } => {
                    if sheet_index == *sheet && !full_row {
                        if *delta < 0 {
                            if &row >= displace_row {
                                if row < displace_row - *delta {
                                    return "#REF!".to_string();
                                }
                                row += *delta;
                            }
                        } else if &row >= displace_row {
                            row += *delta;
                        }
                    }
                }
                DisplaceData::Column {
                    sheet,
                    column: displace_column,
                    delta,
                } => {
                    if sheet_index == *sheet && !full_column {
                        if *delta < 0 {
                            if &column >= displace_column {
                                if column < displace_column - *delta {
                                    return "#REF!".to_string();
                                }
                                column += *delta;
                            }
                        } else if &column >= displace_column {
                            column += *delta;
                        }
                    }
                }
                DisplaceData::CellHorizontal {
                    sheet,
                    row: displace_row,
                    column: displace_column,
                    delta,
                } => {
                    if sheet_index == *sheet && displace_row == &row {
                        if *delta < 0 {
                            if &column >= displace_column {
                                if column < displace_column - *delta {
                                    return "#REF!".to_string();
                                }
                                column += *delta;
                            }
                        } else if &column >= displace_column {
                            column += *delta;
                        }
                    }
                }
                DisplaceData::CellVertical {
                    sheet,
                    row: displace_row,
                    column: displace_column,
                    delta,
                } => {
                    if sheet_index == *sheet && displace_column == &column {
                        if *delta < 0 {
                            if &row >= displace_row {
                                if row < displace_row - *delta {
                                    return "#REF!".to_string();
                                }
                                row += *delta;
                            }
                        } else if &row >= displace_row {
                            row += *delta;
                        }
                    }
                }
                DisplaceData::RowMove {
                    sheet,
                    row: move_row,
                    delta,
                } => {
                    if sheet_index == *sheet {
                        if row == *move_row {
                            row += *delta;
                        } else if *delta > 0 {
                            // Moving the row downwards
                            if row > *move_row && row <= *move_row + *delta {
                                // Intermediate rows move up by one position
                                row -= 1;
                            }
                        } else if *delta < 0 {
                            // Moving the row upwards
                            if row < *move_row && row >= *move_row + *delta {
                                // Intermediate rows move down by one position
                                row += 1;
                            }
                        }
                    }
                }
                DisplaceData::ColumnMove {
                    sheet,
                    column: move_column,
                    delta,
                } => {
                    if sheet_index == *sheet {
                        if column == *move_column {
                            column += *delta;
                        } else if *delta > 0 {
                            // Moving the column to the right
                            if column > *move_column && column <= *move_column + *delta {
                                // Intermediate columns move left by one position
                                column -= 1;
                            }
                        } else if *delta < 0 {
                            // Moving the column to the left
                            if column < *move_column && column >= *move_column + *delta {
                                // Intermediate columns move right by one position
                                column += 1;
                            }
                        }
                    }
                }
                DisplaceData::None => {}
            }
            if row < 1 {
                return "#REF!".to_string();
            }
            let mut row_abs = if absolute_row {
                format!("${row}")
            } else {
                format!("{row}")
            };
            let column = match crate::expressions::utils::number_to_column(column) {
                Some(s) => s,
                None => return "#REF!".to_string(),
            };
            let mut col_abs = if absolute_column {
                format!("${column}")
            } else {
                column
            };
            if full_row {
                row_abs = "".to_string()
            }
            if full_column {
                col_abs = "".to_string()
            }
            match &sheet_name {
                Some(name) => {
                    format!("{}!{}{}", quote_name(name), col_abs, row_abs)
                }
                None => {
                    format!("{col_abs}{row_abs}")
                }
            }
        }
        None => {
            let row_abs = if absolute_row {
                format!("R{row}")
            } else {
                format!("R[{row}]")
            };
            let col_abs = if absolute_column {
                format!("C{column}")
            } else {
                format!("C[{column}]")
            };
            match &sheet_name {
                Some(name) => {
                    format!("{}!{}{}", quote_name(name), row_abs, col_abs)
                }
                None => {
                    format!("{row_abs}{col_abs}")
                }
            }
        }
    }
}

fn format_function(
    name: &str,
    args: &Vec<Node>,
    context: Option<&CellReferenceRC>,
    displace_data: &DisplaceData,
    export_to_excel: bool,
    locale: &Locale,
    language: &Language,
) -> String {
    let mut first = true;
    let mut arguments = "".to_string();
    let arg_separator = if locale.numbers.symbols.decimal == "." {
        ','
    } else {
        ';'
    };
    for el in args {
        if !first {
            arguments = format!(
                "{}{}{}",
                arguments,
                arg_separator,
                stringify(
                    el,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language
                )
            );
        } else {
            first = false;
            arguments = stringify(
                el,
                context,
                displace_data,
                export_to_excel,
                locale,
                language,
            );
        }
    }
    format!("{name}({arguments})")
}

// There is just one representation in the AST (Abstract Syntax Tree) of a formula.
// But three different ways to convert it to a string.
//
// To stringify a formula we need a "context", that is in which cell are we doing the "stringifying"
//
// But there are three ways to stringify a formula:
//
// * To show it to the IronCalc user
// * To store internally
// * To export to Excel
//
// There are, of course correspondingly three "modes" when parsing a formula.
//
// The internal representation is the more different as references are stored in the RC representation.
// The the AST of the formula is kept close to this representation we don't need a context
//
// In the export to Excel representation certain things are different:
// * We add a _xlfn. in front of some (more modern) functions
// * We remove the Implicit Intersection operator when it is automatic and add _xlfn.SINGLE when it is not
//
// Examples:
// * =A1+B2
// * =RC+R1C1
// * =A1+B1

fn stringify(
    node: &Node,
    context: Option<&CellReferenceRC>,
    displace_data: &DisplaceData,
    export_to_excel: bool,
    locale: &Locale,
    language: &Language,
) -> String {
    use self::Node::*;
    match node {
        BooleanKind(value) => {
            if *value {
                language.booleans.r#true.to_string()
            } else {
                language.booleans.r#false.to_string()
            }
        }
        NumberKind(number) => {
            let s = to_excel_precision_str(*number);
            if locale.numbers.symbols.decimal == "." {
                s
            } else {
                s.replace(".", &locale.numbers.symbols.decimal)
            }
        }
        StringKind(value) => format!("\"{value}\""),
        WrongReferenceKind {
            sheet_name,
            column,
            row,
            absolute_row,
            absolute_column,
        } => stringify_reference(
            context,
            &DisplaceData::None,
            &Reference {
                sheet_name,
                sheet_index: 0,
                row: *row,
                column: *column,
                absolute_row: *absolute_row,
                absolute_column: *absolute_column,
            },
            false,
            false,
        ),
        ReferenceKind {
            sheet_name,
            sheet_index,
            column,
            row,
            absolute_row,
            absolute_column,
        } => stringify_reference(
            context,
            displace_data,
            &Reference {
                sheet_name,
                sheet_index: *sheet_index,
                row: *row,
                column: *column,
                absolute_row: *absolute_row,
                absolute_column: *absolute_column,
            },
            false,
            false,
        ),
        RangeKind {
            sheet_name,
            sheet_index,
            absolute_row1,
            absolute_column1,
            row1,
            column1,
            absolute_row2,
            absolute_column2,
            row2,
            column2,
        } => {
            // Note that open ranges SUM(A:A) or SUM(1:1) will be treated as normal ranges in the R1C1 (internal) representation
            // A:A will be R1C[0]:R1048576C[0]
            // So when we are forming the A1 range we need to strip the irrelevant information
            let full_row = *absolute_row1 && *absolute_row2 && (*row1 == 1) && (*row2 == LAST_ROW);
            let full_column = *absolute_column1
                && *absolute_column2
                && (*column1 == 1)
                && (*column2 == LAST_COLUMN);
            let s1 = stringify_reference(
                context,
                displace_data,
                &Reference {
                    sheet_name,
                    sheet_index: *sheet_index,
                    row: *row1,
                    column: *column1,
                    absolute_row: *absolute_row1,
                    absolute_column: *absolute_column1,
                },
                full_row,
                full_column,
            );
            let s2 = stringify_reference(
                context,
                displace_data,
                &Reference {
                    sheet_name: &None,
                    sheet_index: *sheet_index,
                    row: *row2,
                    column: *column2,
                    absolute_row: *absolute_row2,
                    absolute_column: *absolute_column2,
                },
                full_row,
                full_column,
            );
            format!("{s1}:{s2}")
        }
        WrongRangeKind {
            sheet_name,
            absolute_row1,
            absolute_column1,
            row1,
            column1,
            absolute_row2,
            absolute_column2,
            row2,
            column2,
        } => {
            // Note that open ranges SUM(A:A) or SUM(1:1) will be treated as normal ranges in the R1C1 (internal) representation
            // A:A will be R1C[0]:R1048576C[0]
            // So when we are forming the A1 range we need to strip the irrelevant information
            let full_row = *absolute_row1 && *absolute_row2 && (*row1 == 1) && (*row2 == LAST_ROW);
            let full_column = *absolute_column1
                && *absolute_column2
                && (*column1 == 1)
                && (*column2 == LAST_COLUMN);
            let s1 = stringify_reference(
                context,
                &DisplaceData::None,
                &Reference {
                    sheet_name,
                    sheet_index: 0, // HACK
                    row: *row1,
                    column: *column1,
                    absolute_row: *absolute_row1,
                    absolute_column: *absolute_column1,
                },
                full_row,
                full_column,
            );
            let s2 = stringify_reference(
                context,
                &DisplaceData::None,
                &Reference {
                    sheet_name: &None,
                    sheet_index: 0, // HACK
                    row: *row2,
                    column: *column2,
                    absolute_row: *absolute_row2,
                    absolute_column: *absolute_column2,
                },
                full_row,
                full_column,
            );
            format!("{s1}:{s2}")
        }
        OpRangeKind { left, right } => format!(
            "{}:{}",
            stringify(
                left,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            ),
            stringify(
                right,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            )
        ),
        OpConcatenateKind { left, right } => format!(
            "{}&{}",
            stringify(
                left,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            ),
            stringify(
                right,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            )
        ),
        CompareKind { kind, left, right } => format!(
            "{}{}{}",
            stringify(
                left,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            ),
            kind,
            stringify(
                right,
                context,
                displace_data,
                export_to_excel,
                locale,
                language
            )
        ),
        OpSumKind { kind, left, right } => {
            // CompareKind has lower precedence than +/-, so wrap it to preserve semantics
            let left_str = if matches!(**left, CompareKind { .. }) {
                format!(
                    "({})",
                    stringify(
                        left,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                )
            } else {
                stringify(
                    left,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                )
            };
            // if kind is minus then we need parentheses in the right side if they are OpSumKind or CompareKind
            let right_str = if (matches!(kind, OpSum::Minus) && matches!(**right, OpSumKind { .. }))
                | matches!(**right, CompareKind { .. })
            {
                format!(
                    "({})",
                    stringify(
                        right,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                )
            } else {
                stringify(
                    right,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                )
            };

            format!("{left_str}{kind}{right_str}")
        }
        OpProductKind { kind, left, right } => {
            let x = match **left {
                OpSumKind { .. } | CompareKind { .. } => format!(
                    "({})",
                    stringify(
                        left,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                ),
                _ => stringify(
                    left,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                ),
            };
            let y = match **right {
                OpSumKind { .. } | CompareKind { .. } | OpProductKind { .. } => format!(
                    "({})",
                    stringify(
                        right,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                ),
                _ => stringify(
                    right,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                ),
            };
            format!("{x}{kind}{y}")
        }
        OpPowerKind { left, right } => {
            let x = match **left {
                BooleanKind(_)
                | NumberKind(_)
                | UnaryKind { .. }
                | StringKind(_)
                | ReferenceKind { .. }
                | RangeKind { .. }
                | WrongReferenceKind { .. }
                | DefinedNameKind(_)
                | TableNameKind(_)
                | NamedVariableKind { .. }
                | WrongRangeKind { .. } => stringify(
                    left,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                ),
                OpRangeKind { .. }
                | OpConcatenateKind { .. }
                | OpProductKind { .. }
                | OpPowerKind { .. }
                | FunctionKind { .. }
                | NamedFunctionKind { .. }
                | LambdaDefKind { .. }
                | LambdaCallKind { .. }
                | ArrayKind(_)
                | ErrorKind(_)
                | ParseErrorKind { .. }
                | OpSumKind { .. }
                | CompareKind { .. }
                | ImplicitIntersection { .. }
                | SpillRangeOperator { .. }
                | EmptyArgKind => format!(
                    "({})",
                    stringify(
                        left,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                ),
            };
            let y = match **right {
                BooleanKind(_)
                | NumberKind(_)
                | StringKind(_)
                | ReferenceKind { .. }
                | RangeKind { .. }
                | WrongReferenceKind { .. }
                | DefinedNameKind(_)
                | TableNameKind(_)
                | NamedVariableKind { .. }
                | WrongRangeKind { .. } => stringify(
                    right,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                ),
                OpRangeKind { .. }
                | OpConcatenateKind { .. }
                | OpProductKind { .. }
                | OpPowerKind { .. }
                | FunctionKind { .. }
                | NamedFunctionKind { .. }
                | LambdaDefKind { .. }
                | LambdaCallKind { .. }
                | ArrayKind(_)
                | UnaryKind { .. }
                | ErrorKind(_)
                | ParseErrorKind { .. }
                | OpSumKind { .. }
                | CompareKind { .. }
                | ImplicitIntersection { .. }
                | SpillRangeOperator { .. }
                | EmptyArgKind => format!(
                    "({})",
                    stringify(
                        right,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                ),
            };
            format!("{x}^{y}")
        }
        NamedFunctionKind { name, args, id: _ } => format_function(
            &name.to_lowercase(),
            args,
            context,
            displace_data,
            export_to_excel,
            locale,
            language,
        ),
        FunctionKind { kind, args } => {
            let name = if export_to_excel {
                kind.to_xlsx_string()
            } else {
                kind.to_localized_name(language)
            };
            format_function(
                &name,
                args,
                context,
                displace_data,
                export_to_excel,
                locale,
                language,
            )
        }
        ArrayKind(args) => {
            let mut first_row = true;
            let mut matrix_string = String::new();
            let row_separator = if locale.numbers.symbols.decimal == "." {
                ';'
            } else {
                '/'
            };
            let col_separator = if row_separator == ';' { ',' } else { ';' };

            for row in args {
                if !first_row {
                    matrix_string.push(row_separator);
                } else {
                    first_row = false;
                }
                let mut first_column = true;
                let mut row_string = String::new();
                for el in row {
                    if !first_column {
                        row_string.push(col_separator);
                    } else {
                        first_column = false;
                    }
                    row_string.push_str(&to_string_array_node(el, locale, language));
                }
                matrix_string.push_str(&row_string);
            }
            format!("{{{matrix_string}}}")
        }
        TableNameKind(value) => value.to_string(),
        DefinedNameKind((name, ..)) => name.to_string(),
        NamedVariableKind { name, id: _ } => name.to_string(),
        UnaryKind { kind, right } => match kind {
            OpUnary::Minus => {
                let needs_parentheses = match **right {
                    BooleanKind(_)
                    | NumberKind(_)
                    | StringKind(_)
                    | ReferenceKind { .. }
                    | RangeKind { .. }
                    | WrongReferenceKind { .. }
                    | WrongRangeKind { .. }
                    | OpRangeKind { .. }
                    | OpProductKind { .. }
                    | FunctionKind { .. }
                    | NamedFunctionKind { .. }
                    | LambdaDefKind { .. }
                    | LambdaCallKind { .. }
                    | ArrayKind(_)
                    | DefinedNameKind(_)
                    | TableNameKind(_)
                    | NamedVariableKind { .. }
                    | ImplicitIntersection { .. }
                    | SpillRangeOperator { .. }
                    | ErrorKind(_)
                    | ParseErrorKind { .. }
                    | EmptyArgKind => false,

                    // Another minus goes right after this one: `--x`
                    UnaryKind {
                        kind: OpUnary::Minus,
                        ..
                    } => false,

                    // What binds less than the minus: `-(A1=B1)` is not `-A1=B1`
                    OpPowerKind { .. }
                    | OpSumKind { .. }
                    | OpConcatenateKind { .. }
                    | CompareKind { .. }
                    | UnaryKind { .. } => true,
                };
                if needs_parentheses {
                    format!(
                        "-({})",
                        stringify(
                            right,
                            context,
                            displace_data,
                            export_to_excel,
                            locale,
                            language
                        )
                    )
                } else {
                    format!(
                        "-{}",
                        stringify(
                            right,
                            context,
                            displace_data,
                            export_to_excel,
                            locale,
                            language
                        )
                    )
                }
            }
            OpUnary::Percentage => {
                format!(
                    "{}%",
                    stringify(
                        right,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                )
            }
        },
        ErrorKind(kind) => format!("{kind}"),
        ParseErrorKind { formula, .. } => formula.to_string(),
        EmptyArgKind => "".to_string(),
        SpillRangeOperator { child } => {
            if export_to_excel {
                return format!(
                    "_xlfn.ANCHORARRAY({})",
                    stringify(
                        child,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                );
            };
            format!(
                "{}#",
                stringify(
                    child,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language
                )
            )
        }
        LambdaDefKind { parameters, body } => {
            let lambda_name = if export_to_excel {
                "_xlfn.LAMBDA"
            } else {
                "LAMBDA"
            };
            let arg_sep = if locale.numbers.symbols.decimal == "." {
                ","
            } else {
                ";"
            };
            let mut parts: Vec<String> = parameters
                .iter()
                .map(|p| {
                    if export_to_excel {
                        if p.is_optional {
                            format!("_xlop.{}", p.name)
                        } else {
                            format!("_xlpm.{}", p.name)
                        }
                    } else if p.is_optional {
                        format!("[{}]", p.name)
                    } else {
                        p.name.clone()
                    }
                })
                .collect();
            parts.push(stringify(
                body,
                context,
                displace_data,
                export_to_excel,
                locale,
                language,
            ));
            format!("{}({})", lambda_name, parts.join(arg_sep))
        }
        LambdaCallKind { lambda, args } => {
            let arg_sep = if locale.numbers.symbols.decimal == "." {
                ","
            } else {
                ";"
            };
            // When the callee is a plain named variable (unknown identifier used as a function),
            // use lowercase to distinguish from real function calls in R1C1 format and
            // to match the display behaviour of InvalidFunctionKind.
            let lambda_str = match lambda.as_ref() {
                Node::NamedVariableKind { name, id: _ } => name.to_lowercase(),
                other => stringify(
                    other,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language,
                ),
            };
            let call_args: Vec<String> = args
                .iter()
                .map(|a| stringify(a, context, displace_data, export_to_excel, locale, language))
                .collect();
            format!("{}({})", lambda_str, call_args.join(arg_sep))
        }
        ImplicitIntersection {
            automatic: _,
            child,
        } => {
            if export_to_excel {
                // Redundant operators have already been stripped by
                // `remove_redundant_implicit_intersection`; whatever remains is
                // meaningful and must be exported explicitly.
                return format!(
                    "_xlfn.SINGLE({})",
                    stringify(
                        child,
                        context,
                        displace_data,
                        export_to_excel,
                        locale,
                        language
                    )
                );
            }
            format!(
                "@{}",
                stringify(
                    child,
                    context,
                    displace_data,
                    export_to_excel,
                    locale,
                    language
                )
            )
        }
    }
}

pub(crate) fn rename_sheet_in_node(node: &mut Node, sheet_index: u32, new_name: &str) {
    match node {
        // Rename
        Node::ReferenceKind {
            sheet_name,
            sheet_index: index,
            ..
        } => {
            if *index == sheet_index && sheet_name.is_some() {
                *sheet_name = Some(new_name.to_owned());
            }
        }
        Node::RangeKind {
            sheet_name,
            sheet_index: index,
            ..
        } => {
            if *index == sheet_index && sheet_name.is_some() {
                *sheet_name = Some(new_name.to_owned());
            }
        }
        Node::WrongReferenceKind { sheet_name, .. } => {
            if let Some(name) = sheet_name {
                if name.to_uppercase() == new_name.to_uppercase() {
                    *sheet_name = Some(name.to_owned())
                }
            }
        }
        Node::WrongRangeKind { sheet_name, .. } => {
            if sheet_name.is_some() {
                *sheet_name = Some(new_name.to_owned());
            }
        }

        // Go next level
        Node::OpRangeKind { left, right } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::OpConcatenateKind { left, right } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::OpSumKind {
            kind: _,
            left,
            right,
        } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::OpProductKind {
            kind: _,
            left,
            right,
        } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::OpPowerKind { left, right } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::FunctionKind { kind: _, args } => {
            for arg in args {
                rename_sheet_in_node(arg, sheet_index, new_name);
            }
        }
        Node::NamedFunctionKind {
            name: _,
            args,
            id: _,
        } => {
            for arg in args {
                rename_sheet_in_node(arg, sheet_index, new_name);
            }
        }
        Node::CompareKind {
            kind: _,
            left,
            right,
        } => {
            rename_sheet_in_node(left, sheet_index, new_name);
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::UnaryKind { kind: _, right } => {
            rename_sheet_in_node(right, sheet_index, new_name);
        }
        Node::ImplicitIntersection {
            automatic: _,
            child,
        } => {
            rename_sheet_in_node(child, sheet_index, new_name);
        }
        Node::SpillRangeOperator { child } => {
            rename_sheet_in_node(child, sheet_index, new_name);
        }

        // Do nothing
        Node::BooleanKind(_) => {}
        Node::NumberKind(_) => {}
        Node::StringKind(_) => {}
        Node::ErrorKind(_) => {}
        Node::ParseErrorKind { .. } => {}
        Node::ArrayKind(_) => {}
        Node::DefinedNameKind(_) => {}
        Node::TableNameKind(_) => {}
        Node::NamedVariableKind { .. } => {}
        Node::EmptyArgKind => {}
        Node::LambdaDefKind {
            parameters: _,
            body,
        } => {
            rename_sheet_in_node(body, sheet_index, new_name);
        }
        Node::LambdaCallKind { lambda, args } => {
            rename_sheet_in_node(lambda, sheet_index, new_name);
            for arg in args {
                rename_sheet_in_node(arg, sheet_index, new_name);
            }
        }
    }
}

pub(crate) fn rename_defined_name_in_node(
    node: &mut Node,
    name: &str,
    scope: Option<u32>,
    new_name: &str,
) {
    match node {
        // Rename
        Node::DefinedNameKind((n, s, _)) => {
            if name.to_lowercase() == n.to_lowercase() && *s == scope {
                *n = new_name.to_string();
            }
        }
        // Go next level
        Node::OpRangeKind { left, right } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::OpConcatenateKind { left, right } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::OpSumKind {
            kind: _,
            left,
            right,
        } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::OpProductKind {
            kind: _,
            left,
            right,
        } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::OpPowerKind { left, right } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::FunctionKind { kind: _, args } => {
            for arg in args {
                rename_defined_name_in_node(arg, name, scope, new_name);
            }
        }
        Node::NamedFunctionKind {
            name: _,
            args,
            id: _,
        } => {
            for arg in args {
                rename_defined_name_in_node(arg, name, scope, new_name);
            }
        }
        Node::CompareKind {
            kind: _,
            left,
            right,
        } => {
            rename_defined_name_in_node(left, name, scope, new_name);
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::UnaryKind { kind: _, right } => {
            rename_defined_name_in_node(right, name, scope, new_name);
        }
        Node::ImplicitIntersection {
            automatic: _,
            child,
        } => {
            rename_defined_name_in_node(child, name, scope, new_name);
        }
        Node::SpillRangeOperator { child } => {
            rename_defined_name_in_node(child, name, scope, new_name);
        }
        // Do nothing
        Node::BooleanKind(_) => {}
        Node::NumberKind(_) => {}
        Node::StringKind(_) => {}
        Node::ErrorKind(_) => {}
        Node::ParseErrorKind { .. } => {}
        Node::ArrayKind(_) => {}
        Node::EmptyArgKind => {}
        Node::ReferenceKind { .. } => {}
        Node::RangeKind { .. } => {}
        Node::WrongReferenceKind { .. } => {}
        Node::WrongRangeKind { .. } => {}
        Node::TableNameKind(_) => {}
        Node::NamedVariableKind { .. } => {}
        Node::LambdaDefKind {
            parameters: _,
            body,
        } => {
            rename_defined_name_in_node(body, name, scope, new_name);
        }
        Node::LambdaCallKind { lambda, args } => {
            rename_defined_name_in_node(lambda, name, scope, new_name);
            for arg in args {
                rename_defined_name_in_node(arg, name, scope, new_name);
            }
        }
    }
}
