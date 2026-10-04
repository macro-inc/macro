use crate::functions::Function;

use super::Node;

#[cfg(target_arch = "wasm32")]
use regex_lite as regex;

use regex::Regex;
use std::sync::OnceLock;

static RANGE_REFERENCE_REGEX: OnceLock<Regex> = OnceLock::new();

#[allow(clippy::expect_used)]
fn get_re() -> &'static Regex {
    RANGE_REFERENCE_REGEX
        .get_or_init(|| Regex::new(r":[A-Z]*[0-9]*$").expect("Regex is known to be valid"))
}

fn is_range_reference(s: &str) -> bool {
    get_re().is_match(s)
}

/*

# NOTES on the Implicit Intersection operator: @

 Sometimes we obtain a range where we expected a single argument. This can happen:

 * As an argument of a function, eg: `SIN(A1:A5)`
 * As the result of a computation of a formula `=A1:A5`

 In previous versions of the Friendly Giant the spreadsheet engine would perform an operation called _implicit intersection_
 that tries to find a single cell within the range. It works by picking a cell in the range that is the same row or the same column
 as the cell. If there is just one we return that otherwise we return the `#REF!` error.

 Examples:

 * Siting on `C3` the formula `=D1:D5` will return `D3`
 * Sitting on `C3` the formula `=D:D` will return `D3`
 * Sitting on `C3` the formula `=A1:A7` will return `A3`
 * Sitting on `C3` the formula `=A5:A8` will return `#REF!`
 * Sitting on `C3` the formula `D1:G7` will return `#REF!`

 Today's version of the engine will result in a dynamic array spilling the result through several cells.
 To force the old behaviour we can use the _implicit intersection operator_: @

 * `=@A1:A7` or `=SIN(@A1:A7)

 When parsing formulas that come form old workbooks this is done automatically.
 We call this version of the II operator the _automatic_ II operator.

 We can also insert the II operator in places where before was impossible:

 * `=SUM(@A1:A7)`

 This formulas will not be compatible with old versions of the engine. The FG will stringify this as `=SUM(_xlfn.SIMPLE(A1:A7))`.
 */

/// Traverses the formula tree adding the implicit intersection operator in all arguments of functions that
/// expect a scalar but get a range.
///  * A:A => @A:A
///  * SIN(A1:D1) => SIN(@A1:D1)
///
/// Assumes formula return a scalar
pub fn add_implicit_intersection(node: &mut Node, add: bool) {
    match node {
        Node::BooleanKind(_)
        | Node::NumberKind(_)
        | Node::StringKind(_)
        | Node::ErrorKind(_)
        | Node::EmptyArgKind
        | Node::ParseErrorKind { .. }
        | Node::WrongReferenceKind { .. }
        | Node::WrongRangeKind { .. }
        | Node::NamedFunctionKind { .. }
        | Node::ArrayKind(_)
        | Node::ReferenceKind { .. }
        | Node::LambdaDefKind { .. }
        | Node::LambdaCallKind { .. } => {}
        Node::ImplicitIntersection { child, .. } => {
            // We need to check wether the II can be automatic or not
            let mut new_node = child.as_ref().clone();
            add_implicit_intersection(&mut new_node, add);
            if matches!(&new_node, Node::ImplicitIntersection { .. }) {
                *node = new_node
            }
        }
        Node::SpillRangeOperator { child } => {
            add_implicit_intersection(child, add);
        }
        Node::RangeKind {
            row1,
            column1,
            row2,
            column2,
            sheet_name,
            sheet_index,
            absolute_row1,
            absolute_column1,
            absolute_row2,
            absolute_column2,
        } => {
            if add {
                *node = Node::ImplicitIntersection {
                    automatic: true,
                    child: Box::new(Node::RangeKind {
                        sheet_name: sheet_name.clone(),
                        sheet_index: *sheet_index,
                        absolute_row1: *absolute_row1,
                        absolute_column1: *absolute_column1,
                        row1: *row1,
                        column1: *column1,
                        absolute_row2: *absolute_row2,
                        absolute_column2: *absolute_column2,
                        row2: *row2,
                        column2: *column2,
                    }),
                };
            }
        }
        Node::OpRangeKind { left, right } => {
            if add {
                *node = Node::ImplicitIntersection {
                    automatic: true,
                    child: Box::new(Node::OpRangeKind {
                        left: left.clone(),
                        right: right.clone(),
                    }),
                }
            }
        }

        // operations
        Node::UnaryKind { right, .. } => add_implicit_intersection(right, add),
        Node::OpConcatenateKind { left, right }
        | Node::OpSumKind { left, right, .. }
        | Node::OpProductKind { left, right, .. }
        | Node::OpPowerKind { left, right, .. }
        | Node::CompareKind { left, right, .. } => {
            add_implicit_intersection(left, add);
            add_implicit_intersection(right, add);
        }

        Node::DefinedNameKind(v) => {
            if add {
                // Not all defined names deserve the II operator
                // For instance =Sheet1!A1 doesn't need to be intersected
                if is_range_reference(&v.2) {
                    *node = Node::ImplicitIntersection {
                        automatic: true,
                        child: Box::new(Node::DefinedNameKind(v.to_owned())),
                    }
                }
            }
        }
        Node::NamedVariableKind { name, id } => {
            if add {
                *node = Node::ImplicitIntersection {
                    automatic: true,
                    child: Box::new(Node::NamedVariableKind {
                        name: name.clone(),
                        id: *id,
                    }),
                }
            }
        }
        Node::TableNameKind(_) => {
            // noop for now
        }
        Node::FunctionKind { kind, args } => {
            let arg_count = args.len();
            let signature = get_function_args_signature(kind, arg_count);
            for index in 0..arg_count {
                if matches!(signature[index], Signature::Scalar)
                    && matches!(
                        run_static_analysis_on_node(&args[index]),
                        StaticResult::Range(_, _) | StaticResult::Unknown
                    )
                {
                    add_implicit_intersection(&mut args[index], true);
                } else {
                    add_implicit_intersection(&mut args[index], false);
                }
            }
            // There are some function that will never add an automatic II:
            let new_function = matches!(kind, Function::Let | Function::Lambda);
            if !new_function
                && add
                && matches!(
                    run_static_analysis_on_node(node),
                    StaticResult::Range(_, _) | StaticResult::Unknown
                )
            {
                *node = Node::ImplicitIntersection {
                    automatic: true,
                    child: Box::new(node.clone()),
                }
            }
        }
    };
}

/// Inverse of [`add_implicit_intersection`], used when exporting to Excel.
///
/// The internal (RC) representation stores every implicit intersection as `@`,
/// losing the `automatic` flag. When exporting we must decide, for each `@`,
/// whether it should be written as `_xlfn.SINGLE(...)` (because it is meaningful)
/// or dropped (because `add_implicit_intersection` would re-insert it on import).
///
/// That decision depends on the *context* of the operator, exactly like
/// `add_implicit_intersection`: an `@` is redundant only in a position that
/// expects a scalar (`add == true`). Crucially, an `@` sitting in a `Vector`
/// argument of a function such as `SUM` is **not** redundant: on import no
/// automatic intersection is added there, so dropping it would change the result
/// (e.g. `SUM(A1,B1,@J:J)` would become `SUM(A1,B1,J:J)`, scanning the whole
/// column). This pass removes only the redundant operators, leaving the rest to
/// be stringified as `_xlfn.SINGLE`.
///
/// `add` mirrors the flag in `add_implicit_intersection` and must start `true`
/// (a formula is evaluated in a scalar context).
pub fn remove_redundant_implicit_intersection(node: &mut Node, add: bool) {
    match node {
        // Leaves and nodes that never contain a nested implicit intersection.
        Node::BooleanKind(_)
        | Node::NumberKind(_)
        | Node::StringKind(_)
        | Node::ErrorKind(_)
        | Node::EmptyArgKind
        | Node::ParseErrorKind { .. }
        | Node::WrongReferenceKind { .. }
        | Node::WrongRangeKind { .. }
        | Node::NamedFunctionKind { .. }
        | Node::ArrayKind(_)
        | Node::ReferenceKind { .. }
        | Node::RangeKind { .. }
        | Node::OpRangeKind { .. }
        | Node::DefinedNameKind(_)
        | Node::NamedVariableKind { .. }
        | Node::TableNameKind(_)
        | Node::LambdaDefKind { .. }
        | Node::LambdaCallKind { .. } => {}
        Node::ImplicitIntersection { child, .. } => {
            if add {
                // Would `add_implicit_intersection` re-insert this operator on
                // import? Probe the child in a scalar context to find out.
                let mut probe = child.as_ref().clone();
                add_implicit_intersection(&mut probe, true);
                if matches!(probe, Node::ImplicitIntersection { .. }) {
                    // Redundant: drop the operator and keep cleaning the child.
                    // The child is still in the same (scalar) context, so recurse
                    // with `add` to also remove any nested redundant operators.
                    let mut inner = child.as_ref().clone();
                    remove_redundant_implicit_intersection(&mut inner, add);
                    *node = inner;
                    return;
                }
            }
            // Meaningful operator: keep it, but still clean any nested ones.
            remove_redundant_implicit_intersection(child, false);
        }
        Node::SpillRangeOperator { child } => {
            remove_redundant_implicit_intersection(child, add);
        }
        Node::UnaryKind { right, .. } => remove_redundant_implicit_intersection(right, add),
        Node::OpConcatenateKind { left, right }
        | Node::OpSumKind { left, right, .. }
        | Node::OpProductKind { left, right, .. }
        | Node::OpPowerKind { left, right, .. }
        | Node::CompareKind { left, right, .. } => {
            remove_redundant_implicit_intersection(left, add);
            remove_redundant_implicit_intersection(right, add);
        }
        Node::FunctionKind { kind, args } => {
            let arg_count = args.len();
            let signature = get_function_args_signature(kind, arg_count);
            for index in 0..arg_count {
                // Scalar arguments are an intersecting context; vector arguments
                // (ranges/arrays) are not.
                let child_add = matches!(signature[index], Signature::Scalar);
                remove_redundant_implicit_intersection(&mut args[index], child_add);
            }
        }
    };
}

/// The result of the static analysis of a node
pub enum StaticResult {
    // The result of the evaluation is a single value (number, string, boolean, error)
    Scalar,
    // The result of the evaluation is an array with dimensions (rows, columns)
    Array(i32, i32),
    // The result of the evaluation is a range with dimensions (rows, columns)
    Range(i32, i32),
    // The result of the evaluation is unknown, we cannot guaranty it is a scalar, an array or a range
    Unknown,
    // TODO: What if one of the dimensions is known?
    // what if the dimensions are unknown but bounded?
}

fn static_analysis_op_nodes(left: &Node, right: &Node) -> StaticResult {
    let lhs = run_static_analysis_on_node(left);
    let rhs = run_static_analysis_on_node(right);
    match (lhs, rhs) {
        (StaticResult::Scalar, StaticResult::Scalar) => StaticResult::Scalar,
        (StaticResult::Scalar, StaticResult::Array(a, b) | StaticResult::Range(a, b)) => {
            StaticResult::Array(a, b)
        }

        (StaticResult::Array(a, b) | StaticResult::Range(a, b), StaticResult::Scalar) => {
            StaticResult::Array(a, b)
        }
        (
            StaticResult::Array(a1, b1) | StaticResult::Range(a1, b1),
            StaticResult::Array(a2, b2) | StaticResult::Range(a2, b2),
        ) => StaticResult::Array(a1.max(a2), b1.max(b2)),

        (_, StaticResult::Unknown) => StaticResult::Unknown,
        (StaticResult::Unknown, _) => StaticResult::Unknown,
    }
}

// Returns:
//  * Scalar if we can proof the result of the evaluation is a scalar
//  * Array(a, b) if we know it will be an a x b array.
//  * Range(a, b) if we know it will be a a x b range.
//  * Unknown if we cannot guaranty either
pub(crate) fn run_static_analysis_on_node(node: &Node) -> StaticResult {
    match node {
        Node::BooleanKind(_)
        | Node::NumberKind(_)
        | Node::StringKind(_)
        | Node::ErrorKind(_)
        | Node::EmptyArgKind => StaticResult::Scalar,
        Node::UnaryKind { right, .. } => run_static_analysis_on_node(right),
        Node::ParseErrorKind { .. } => {
            // StaticResult::Unknown is also valid
            StaticResult::Scalar
        }
        Node::WrongReferenceKind { .. } => {
            // StaticResult::Unknown is also valid
            StaticResult::Scalar
        }
        Node::WrongRangeKind { .. } => {
            // StaticResult::Unknown or Array is also valid
            StaticResult::Scalar
        }
        Node::NamedFunctionKind { .. } => {
            // A named-function call invokes a LAMBDA (defined-name or LET-bound) whose
            // result shape is unknown at parse time — it may well be an array that needs
            // to spill (e.g. a LAMBDA wrapping SEQUENCE). Treat it like LambdaCallKind.
            StaticResult::Unknown
        }
        Node::ArrayKind(array) => {
            let n = array.len() as i32;
            let m = array.first().map(|row| row.len() as i32).unwrap_or(0);
            StaticResult::Array(n, m)
        }
        Node::RangeKind {
            row1,
            column1,
            row2,
            column2,
            ..
        } => StaticResult::Range(row2 - row1, column2 - column1),
        Node::OpRangeKind { .. } => {
            // TODO: We could do a bit better here
            StaticResult::Unknown
        }
        Node::ReferenceKind { .. } => StaticResult::Scalar,

        // binary operations
        Node::OpConcatenateKind { left, right }
        | Node::OpSumKind { left, right, .. }
        | Node::OpProductKind { left, right, .. }
        | Node::OpPowerKind { left, right, .. }
        | Node::CompareKind { left, right, .. } => static_analysis_op_nodes(left, right),

        // defined names
        Node::DefinedNameKind(_) => {
            // TODO: We could do better if we tracked the defined names
            StaticResult::Unknown
        }
        Node::NamedVariableKind { .. } => StaticResult::Scalar,
        Node::TableNameKind(_) => StaticResult::Unknown,
        Node::FunctionKind { kind, args } => lifted_static_result(kind, args)
            .unwrap_or_else(|| static_analysis_on_function(kind, args)),
        Node::ImplicitIntersection { .. } => StaticResult::Scalar,
        Node::SpillRangeOperator { .. } => StaticResult::Unknown,
        Node::LambdaDefKind { .. } => StaticResult::Unknown,
        Node::LambdaCallKind { .. } => StaticResult::Unknown,
    }
}

/// MACRO: parameters evaluated element by element when they receive a range
/// or an array (see `functions/lift.rs`): every single-value parameter, except
/// in functions that evaluate arguments lazily, pass references through, or
/// already build arrays themselves.
pub(crate) fn lifted_parameters(kind: &Function, arg_count: usize) -> Option<Vec<bool>> {
    use Function::*;
    if matches!(
        kind,
        If | Ifs
            | Iferror
            | Ifna
            | Switch
            | Choose
            | Let
            | Lambda
            | Map
            | Reduce
            | Scan
            | Bycol
            | Byrow
            | Makearray
            | Isomitted
            | Type
            | Isref
            | Isformula
            | Formulatext
            | Cell
            | Sheet
            | Sheets
            | Areas
            | Rows
            | Columns
            | Row
            | Column
            | Offset
            | Indirect
            | Trimrange
            | Sequence
            | Randarray
            | Unique
            | Sort
            | Sortby
            | Filter
            | Transpose
            | Textsplit
            | Tocol
            | Torow
            | Wrapcols
            | Wraprows
            | Take
            | Drop
            | Choosecols
            | Chooserows
            | Expand
            | Hstack
            | Vstack
            | Frequency
            | Mmult
            | Minverse
            | Munit
            | Linest
            | Logest
            | Trend
            | Growth
            | Arraytotext
            | Valuetotext
            | Hyperlink
    ) {
        return None;
    }
    // Some signatures have a fixed length, whatever the number of arguments.
    let signature = get_function_args_signature(kind, arg_count);
    let mut lifted: Vec<bool> = (0..arg_count)
        .map(|index| matches!(signature.get(index), Some(Signature::Scalar)))
        .collect();
    // The holidays of WORKDAY and WORKDAY.INTL are a list.
    match kind {
        Workday if arg_count > 2 => lifted[2] = false,
        WorkdayIntl if arg_count > 3 => lifted[3] = false,
        _ => {}
    }
    // The signatures mark lookup values as vectors for legacy intersection,
    // yet Excel looks up each value of an array: MATCH(A1:A9, B:B, 0).
    if matches!(kind, Match | Xmatch | Vlookup | Hlookup | Lookup | Xlookup) && arg_count > 0 {
        lifted[0] = true;
    }
    // XLOOKUP returns its if_not_found argument whole.
    if matches!(kind, Xlookup) && arg_count > 3 {
        lifted[3] = false;
    }
    // Each criterion of the *IFS functions: COUNTIFS(A:A, {"x","y"}).
    match kind {
        Countifs => (1..arg_count).step_by(2).for_each(|i| lifted[i] = true),
        Sumifs | Averageifs | Maxifs | Minifs => {
            (2..arg_count).step_by(2).for_each(|i| lifted[i] = true)
        }
        _ => {}
    }
    lifted.contains(&true).then_some(lifted)
}

/// MACRO: the shape of a call whose lifted parameters receive ranges or
/// arrays: the broadcast of those arguments, as for `scalar_arguments`.
fn lifted_static_result(kind: &Function, args: &[Node]) -> Option<StaticResult> {
    let lifted = lifted_parameters(kind, args.len())?;
    let mut rows = 0;
    let mut columns = 0;
    for (arg, lifted) in args.iter().zip(lifted) {
        if !lifted {
            continue;
        }
        match run_static_analysis_on_node(arg) {
            StaticResult::Scalar => {}
            StaticResult::Array(a, b) | StaticResult::Range(a, b) => {
                rows = rows.max(a);
                columns = columns.max(b);
            }
            StaticResult::Unknown => return Some(StaticResult::Unknown),
        }
    }
    if rows == 0 && columns == 0 {
        return None;
    }
    Some(StaticResult::Array(rows, columns))
}

// If all the arguments are scalars the function will return a scalar
// If any of the arguments is a range or an array it will return an array
fn scalar_arguments(args: &[Node]) -> StaticResult {
    let mut n = 0;
    let mut m = 0;
    for arg in args {
        match run_static_analysis_on_node(arg) {
            StaticResult::Scalar => {
                // noop
            }
            StaticResult::Array(a, b) | StaticResult::Range(a, b) => {
                n = n.max(a);
                m = m.max(b);
            }
            StaticResult::Unknown => return StaticResult::Unknown,
        }
    }
    if n == 0 && m == 0 {
        return StaticResult::Scalar;
    }
    StaticResult::Array(n, m)
}

// We only care if the function can return a range or not
fn not_implemented(_args: &[Node]) -> StaticResult {
    StaticResult::Scalar
}

/// MACRO: XLOOKUP returns a whole row (or column) of a return array with
/// several rows and columns, which spills. Range sizes are differences here:
/// `B1:B9` is `Range(8, 0)`.
fn static_analysis_xlookup(args: &[Node]) -> StaticResult {
    match args.get(2).map(run_static_analysis_on_node) {
        None | Some(StaticResult::Scalar) => StaticResult::Scalar,
        Some(StaticResult::Range(rows, columns) | StaticResult::Array(rows, columns))
            if rows == 0 || columns == 0 =>
        {
            StaticResult::Scalar
        }
        Some(_) => StaticResult::Unknown,
    }
}

/// ROW and COLUMN give a single number for a single cell, and when the
/// reference stays within one row (ROW) or one column (COLUMN). Otherwise they
/// give a vector of numbers, one for each row or column of the reference.
fn static_analysis_row_column(args: &[Node], is_row: bool) -> StaticResult {
    let Some(reference) = args.first() else {
        return StaticResult::Scalar;
    };
    // The vector is `Unknown` and not `Array`: a formula from before dynamic
    // arrays expects a single number here, and it is the unknown results that
    // are intersected (see `add_implicit_intersection`).
    match reference {
        Node::RangeKind {
            absolute_row1,
            absolute_column1,
            row1,
            column1,
            absolute_row2,
            absolute_column2,
            row2,
            column2,
            ..
        } => {
            // The two ends are only comparable if both are absolute or both
            // are relative to the cell.
            let single = if is_row {
                absolute_row1 == absolute_row2 && row1 == row2
            } else {
                absolute_column1 == absolute_column2 && column1 == column2
            };
            if single {
                StaticResult::Scalar
            } else {
                StaticResult::Unknown
            }
        }
        other => match run_static_analysis_on_node(other) {
            StaticResult::Scalar => StaticResult::Scalar,
            _ => StaticResult::Unknown,
        },
    }
}

/// SUMIF spills according to the shape of its criteria argument (`args[1]`); the
/// criteria_range and sum_range arguments are consumed, not broadcast. A scalar
/// criterion yields a scalar; a range/array criterion yields an array of the
/// same dimensions.
fn sumif_static_result(args: &[Node]) -> StaticResult {
    match args.get(1) {
        Some(criteria) => match run_static_analysis_on_node(criteria) {
            StaticResult::Array(a, b) | StaticResult::Range(a, b) => StaticResult::Array(a, b),
            StaticResult::Scalar => StaticResult::Scalar,
            StaticResult::Unknown => StaticResult::Unknown,
        },
        None => StaticResult::Scalar,
    }
}

fn static_analysis_offset(args: &[Node]) -> StaticResult {
    // If first argument is a single cell reference and there are no4th and 5th argument,
    // or they are 1, then it is a scalar
    let arg_count = args.len();
    if arg_count < 3 {
        // Actually an error
        return StaticResult::Scalar;
    }
    if !matches!(args[0], Node::ReferenceKind { .. }) {
        return StaticResult::Unknown;
    }
    if arg_count == 3 {
        return StaticResult::Scalar;
    }
    match args[3] {
        Node::NumberKind(f) => {
            if f != 1.0 {
                return StaticResult::Unknown;
            }
        }
        _ => return StaticResult::Unknown,
    };
    if arg_count == 4 {
        return StaticResult::Scalar;
    }
    match args[4] {
        Node::NumberKind(f) => {
            if f != 1.0 {
                return StaticResult::Unknown;
            }
        }
        _ => return StaticResult::Unknown,
    };
    // Both height and width are explicitly 1, so OFFSET will return a single cell
    StaticResult::Scalar
}

// fn static_analysis_choose(_args: &[Node]) -> StaticResult {
//     // We will always insert the @ in CHOOSE, but technically it is only needed if one of the elements is a range
//     StaticResult::Unknown
// }

fn static_analysis_indirect(_args: &[Node]) -> StaticResult {
    // We will always insert the @, but we don't need to do that in every scenario`
    StaticResult::Unknown
}

fn static_analysis_index(_args: &[Node]) -> StaticResult {
    // INDEX has two forms, but they are indistinguishable at parse time.
    StaticResult::Unknown
}

#[derive(Clone)]
enum Signature {
    Scalar,
    Vector,
    Error,
}

fn args_signature_no_args(arg_count: usize) -> Vec<Signature> {
    if arg_count == 0 {
        vec![]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_scalars(
    arg_count: usize,
    required_count: usize,
    optional_count: usize,
) -> Vec<Signature> {
    if arg_count >= required_count && arg_count <= required_count + optional_count {
        vec![Signature::Scalar; arg_count]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_lambda(arg_count: usize) -> Vec<Signature> {
    // LAMBDA([param1, param2, ...], body) — at least 1 arg (the body)
    if arg_count == 0 {
        return vec![Signature::Error; arg_count];
    }
    // All parameter names are Scalar; the final body argument is Vector.
    let mut sig = vec![Signature::Scalar; arg_count];
    sig[arg_count - 1] = Signature::Vector;
    sig
}

fn args_signature_let(arg_count: usize) -> Vec<Signature> {
    // LET requires an odd number of args >= 3: name1, value1, [name2, value2, ...], body
    if arg_count < 3 || arg_count.is_multiple_of(2) {
        return vec![Signature::Error; arg_count];
    }
    (0..arg_count)
        .map(|i| {
            // Odd indices are value expressions; last index is the body.
            // Both should be Vector so range references are not implicitly intersected.
            // Even indices (except last) are name declarations — Scalar is fine since
            // they are never actually evaluated as range expressions.
            if i % 2 == 1 || i == arg_count - 1 {
                Signature::Vector
            } else {
                Signature::Scalar
            }
        })
        .collect()
}

fn args_signature_arraytotext(arg_count: usize) -> Vec<Signature> {
    match arg_count {
        1 => vec![Signature::Vector],
        2 => vec![Signature::Vector, Signature::Scalar],
        _ => vec![Signature::Error; arg_count],
    }
}

fn args_signature_one_vector(arg_count: usize) -> Vec<Signature> {
    if arg_count == 1 {
        vec![Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_sumif(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector, Signature::Scalar]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Scalar, Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

/// SUMIF signature with the criteria argument as a `Vector` instead of a
/// `Scalar`. This stops a range/array criteria from being collapsed by implicit
/// intersection, so SUMIF can spill one sum per criterion. (COUNTIF/AVERAGEIF
/// keep the classic [`args_signature_sumif`], intersecting range criteria.)
fn args_signature_sumif_spill(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector, Signature::Vector]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Vector, Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

// 1 or none scalars
fn args_signature_sheet(arg_count: usize) -> Vec<Signature> {
    if arg_count == 0 {
        vec![]
    } else if arg_count == 1 {
        vec![Signature::Scalar]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_hlookup(arg_count: usize) -> Vec<Signature> {
    if arg_count == 3 {
        vec![Signature::Vector, Signature::Vector, Signature::Scalar]
    } else if arg_count == 4 {
        vec![
            Signature::Vector,
            Signature::Vector,
            Signature::Scalar,
            Signature::Vector,
        ]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_index(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector, Signature::Scalar]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
    } else if arg_count == 4 {
        vec![
            Signature::Vector,
            Signature::Scalar,
            Signature::Scalar,
            Signature::Scalar,
        ]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_lookup(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector, Signature::Vector]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Vector, Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_match(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector, Signature::Vector]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Vector, Signature::Scalar]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_offset(arg_count: usize) -> Vec<Signature> {
    if arg_count == 3 {
        vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
    } else if arg_count == 4 {
        vec![
            Signature::Vector,
            Signature::Scalar,
            Signature::Scalar,
            Signature::Scalar,
        ]
    } else if arg_count == 5 {
        vec![
            Signature::Vector,
            Signature::Scalar,
            Signature::Scalar,
            Signature::Scalar,
            Signature::Scalar,
        ]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_row(arg_count: usize) -> Vec<Signature> {
    if arg_count == 0 {
        vec![]
    } else if arg_count == 1 {
        vec![Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_xlookup(arg_count: usize) -> Vec<Signature> {
    if !(3..=6).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result[1] = Signature::Vector;
    result[2] = Signature::Vector;
    result
}

fn args_signature_sort(arg_count: usize) -> Vec<Signature> {
    if !(1..=4).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_sortby(arg_count: usize) -> Vec<Signature> {
    // Valid: 2, 3, 5, 7, ... (n==2 || n==3 || n>=5 with odd count)
    if arg_count < 2 || (arg_count > 3 && arg_count.is_multiple_of(2)) {
        return vec![Signature::Error; arg_count];
    }
    // arg[0] = array (Vector), arg[1] = by_array1 (Vector),
    // optional arg[2] = sort_order1 (Scalar), then pairs (Vector, Scalar)
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    let mut i = 1;
    while i < arg_count {
        result[i] = Signature::Vector; // by_array
        i += 2; // skip the sort_order (Scalar)
    }
    result
}

fn args_signature_unique(arg_count: usize) -> Vec<Signature> {
    if !(1..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_filter(arg_count: usize) -> Vec<Signature> {
    if !(2..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result[1] = Signature::Vector;
    result
}

fn args_signature_sequence(arg_count: usize) -> Vec<Signature> {
    if !(1..=4).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    vec![Signature::Scalar; arg_count]
}

fn args_signature_randarray(arg_count: usize) -> Vec<Signature> {
    if arg_count > 5 {
        return vec![Signature::Error; arg_count];
    }
    vec![Signature::Scalar; arg_count]
}

fn args_signature_take(arg_count: usize) -> Vec<Signature> {
    if !(2..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_drop(arg_count: usize) -> Vec<Signature> {
    if !(2..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_tocol(arg_count: usize) -> Vec<Signature> {
    if !(1..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_bycol_byrow(arg_count: usize) -> Vec<Signature> {
    if arg_count != 2 {
        return vec![Signature::Error; arg_count];
    }
    vec![Signature::Vector, Signature::Scalar]
}

fn args_signature_map(arg_count: usize) -> Vec<Signature> {
    if arg_count < 2 {
        return vec![Signature::Error; arg_count];
    }
    // All args except the last (lambda) are Vector; the lambda is Scalar.
    let mut result = vec![Signature::Vector; arg_count];
    result[arg_count - 1] = Signature::Scalar;
    result
}

fn args_signature_reduce(arg_count: usize) -> Vec<Signature> {
    match arg_count {
        2 => vec![Signature::Vector, Signature::Scalar],
        3 => vec![Signature::Scalar, Signature::Vector, Signature::Scalar],
        _ => vec![Signature::Error; arg_count],
    }
}

fn args_signature_scan(arg_count: usize) -> Vec<Signature> {
    match arg_count {
        2 => vec![Signature::Vector, Signature::Scalar],
        3 => vec![Signature::Scalar, Signature::Vector, Signature::Scalar],
        _ => vec![Signature::Error; arg_count],
    }
}

fn args_signature_textsplit(arg_count: usize) -> Vec<Signature> {
    if !(2..=6).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    // col_delimiter (index 1) and row_delimiter (index 2) can be arrays
    let mut result = vec![Signature::Scalar; arg_count];
    result[1] = Signature::Vector;
    if arg_count >= 3 {
        result[2] = Signature::Vector;
    }
    result
}

fn args_signature_textafter(arg_count: usize) -> Vec<Signature> {
    if !(2..=6).contains(&arg_count) {
        vec![Signature::Scalar; arg_count]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_textjoin(arg_count: usize) -> Vec<Signature> {
    if arg_count >= 3 {
        let mut result = vec![Signature::Vector; arg_count];
        result[0] = Signature::Scalar;
        result[1] = Signature::Scalar;
        result
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_npv(arg_count: usize) -> Vec<Signature> {
    if arg_count < 2 {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Vector; arg_count];
    result[0] = Signature::Scalar;
    result
}

fn args_signature_irr(arg_count: usize) -> Vec<Signature> {
    if arg_count > 2 {
        vec![Signature::Error; arg_count]
    } else if arg_count == 1 {
        vec![Signature::Vector]
    } else {
        vec![Signature::Vector, Signature::Scalar]
    }
}

fn args_signature_xirr(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Vector; arg_count]
    } else if arg_count == 3 {
        vec![Signature::Vector, Signature::Vector, Signature::Scalar]
    } else {
        vec![Signature::Error; arg_count]
    }
}

fn args_signature_mirr(arg_count: usize) -> Vec<Signature> {
    if arg_count != 3 {
        vec![Signature::Error; arg_count]
    } else {
        vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
    }
}

fn args_signature_xnpv(arg_count: usize) -> Vec<Signature> {
    if arg_count != 3 {
        vec![Signature::Error; arg_count]
    } else {
        vec![Signature::Scalar, Signature::Vector, Signature::Vector]
    }
}

// NETWORKDAYS(start_date, end_date, [holidays])
// Parameters: start_date (scalar), end_date (scalar), holidays (optional vector)
fn args_signature_networkdays(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Scalar, Signature::Scalar]
    } else if arg_count == 3 {
        vec![Signature::Scalar, Signature::Scalar, Signature::Vector]
    } else {
        vec![Signature::Error; arg_count]
    }
}

// NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])
// Parameters: start_date (scalar), end_date (scalar), weekend (optional scalar), holidays (optional vector)
fn args_signature_networkdays_intl(arg_count: usize) -> Vec<Signature> {
    if arg_count == 2 {
        vec![Signature::Scalar, Signature::Scalar]
    } else if arg_count == 3 {
        vec![Signature::Scalar, Signature::Scalar, Signature::Scalar]
    } else if arg_count == 4 {
        vec![
            Signature::Scalar,
            Signature::Scalar,
            Signature::Scalar,
            Signature::Vector,
        ]
    } else {
        vec![Signature::Error; arg_count]
    }
}

// FIXME: This is terrible duplications of efforts. We use the signature in at least three different places:
// 1. When computing the function
// 2. Checking the arguments to see if we need to insert the implicit intersection operator
// 3. Understanding the return value
//
fn args_signature_xmatch(arg_count: usize) -> Vec<Signature> {
    if !(2..=4).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[1] = Signature::Vector;
    result
}

fn args_signature_trimrange(arg_count: usize) -> Vec<Signature> {
    if !(1..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_address(arg_count: usize) -> Vec<Signature> {
    if !(2..=5).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    vec![Signature::Scalar; arg_count]
}

fn args_signature_choose(arg_count: usize) -> Vec<Signature> {
    // CHOOSE(index, value1, ...): the index is a scalar; the value arguments
    // pass references through untouched (Excel: SUM(CHOOSE(2, A1:A5, B1:B5))
    // sums the chosen range). In scalar context the implicit intersection is
    // applied to the CHOOSE call itself, never to its arms.
    if arg_count < 2 {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Vector; arg_count];
    result[0] = Signature::Scalar;
    result
}

fn args_signature_choosecols(arg_count: usize) -> Vec<Signature> {
    if arg_count < 2 {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_expand(arg_count: usize) -> Vec<Signature> {
    if !(2..=4).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

fn args_signature_wrapcols(arg_count: usize) -> Vec<Signature> {
    if !(2..=3).contains(&arg_count) {
        return vec![Signature::Error; arg_count];
    }
    let mut result = vec![Signature::Scalar; arg_count];
    result[0] = Signature::Vector;
    result
}

// The signature of the functions should be defined only once

// Given a function and a number of arguments this returns the arguments at each position
// are expected to be scalars or vectors (array/ranges).
// Sets signature::Error to all arguments if the number of arguments is incorrect.
fn get_function_args_signature(kind: &Function, arg_count: usize) -> Vec<Signature> {
    match kind {
        Function::And => vec![Signature::Vector; arg_count],
        Function::False => args_signature_no_args(arg_count),
        Function::If => args_signature_scalars(arg_count, 2, 1),
        Function::Iferror => args_signature_scalars(arg_count, 2, 0),
        Function::Ifna => args_signature_scalars(arg_count, 2, 0),
        Function::Ifs => vec![Signature::Scalar; arg_count],
        Function::Lambda => args_signature_lambda(arg_count),
        Function::Let => args_signature_let(arg_count),
        Function::Not => args_signature_scalars(arg_count, 1, 0),
        Function::Or => vec![Signature::Vector; arg_count],
        Function::Switch => vec![Signature::Scalar; arg_count],
        Function::True => args_signature_no_args(arg_count),
        Function::Xor => vec![Signature::Vector; arg_count],
        Function::Abs => args_signature_scalars(arg_count, 1, 0),
        Function::Acos => args_signature_scalars(arg_count, 1, 0),
        Function::Acosh => args_signature_scalars(arg_count, 1, 0),
        Function::Asin => args_signature_scalars(arg_count, 1, 0),
        Function::Asinh => args_signature_scalars(arg_count, 1, 0),
        Function::Atan => args_signature_scalars(arg_count, 1, 0),
        Function::Atan2 => args_signature_scalars(arg_count, 2, 0),
        Function::Atanh => args_signature_scalars(arg_count, 1, 0),
        Function::Choose => args_signature_choose(arg_count),
        Function::Column => args_signature_row(arg_count),
        Function::Columns => args_signature_one_vector(arg_count),
        Function::Ln => args_signature_scalars(arg_count, 1, 0),
        Function::Log => args_signature_scalars(arg_count, 1, 1),
        Function::Log10 => args_signature_scalars(arg_count, 1, 0),
        Function::Cos => args_signature_scalars(arg_count, 1, 0),
        Function::Cosh => args_signature_scalars(arg_count, 1, 0),
        Function::Max => vec![Signature::Vector; arg_count],
        Function::Min => vec![Signature::Vector; arg_count],
        Function::Pi => args_signature_no_args(arg_count),
        Function::Power => args_signature_scalars(arg_count, 2, 0),
        Function::Product => vec![Signature::Vector; arg_count],
        Function::Round => args_signature_scalars(arg_count, 2, 0),
        Function::Rounddown => args_signature_scalars(arg_count, 2, 0),
        Function::Roundup => args_signature_scalars(arg_count, 2, 0),
        Function::Sin => args_signature_scalars(arg_count, 1, 0),
        Function::Sinh => args_signature_scalars(arg_count, 1, 0),
        Function::Sqrt => args_signature_scalars(arg_count, 1, 0),
        Function::Sqrtpi => args_signature_scalars(arg_count, 1, 0),
        Function::Sum => vec![Signature::Vector; arg_count],
        Function::Sumif => args_signature_sumif_spill(arg_count),
        Function::Sumifs => vec![Signature::Vector; arg_count],
        Function::Tan => args_signature_scalars(arg_count, 1, 0),
        Function::Tanh => args_signature_scalars(arg_count, 1, 0),
        Function::ErrorType => args_signature_scalars(arg_count, 1, 0),
        Function::Isblank => args_signature_scalars(arg_count, 1, 0),
        Function::Iserr => args_signature_scalars(arg_count, 1, 0),
        Function::Iserror => args_signature_scalars(arg_count, 1, 0),
        Function::Iseven => args_signature_scalars(arg_count, 1, 0),
        Function::Isformula => args_signature_scalars(arg_count, 1, 0),
        Function::Islogical => args_signature_scalars(arg_count, 1, 0),
        Function::Isna => args_signature_scalars(arg_count, 1, 0),
        Function::Isnontext => args_signature_scalars(arg_count, 1, 0),
        Function::Isnumber => args_signature_scalars(arg_count, 1, 0),
        Function::Isodd => args_signature_scalars(arg_count, 1, 0),
        Function::Isomitted => args_signature_scalars(arg_count, 1, 0),
        Function::Isref => args_signature_one_vector(arg_count),
        Function::Istext => args_signature_scalars(arg_count, 1, 0),
        Function::Na => args_signature_no_args(arg_count),
        Function::Sheet => args_signature_sheet(arg_count),
        Function::Type => args_signature_one_vector(arg_count),
        Function::Address => args_signature_address(arg_count),
        Function::Areas => args_signature_one_vector(arg_count),
        Function::Choosecols => args_signature_choosecols(arg_count),
        Function::Chooserows => args_signature_choosecols(arg_count),
        Function::Expand => args_signature_expand(arg_count),
        Function::Hlookup => args_signature_hlookup(arg_count),
        Function::Hstack => vec![Signature::Vector; arg_count],
        Function::Hyperlink => args_signature_scalars(arg_count, 1, 1),
        Function::Index => args_signature_index(arg_count),
        Function::Indirect => args_signature_scalars(arg_count, 1, 1),
        Function::Lookup => args_signature_lookup(arg_count),
        Function::Match => args_signature_match(arg_count),
        Function::Offset => args_signature_offset(arg_count),
        Function::Row => args_signature_row(arg_count),
        Function::Rows => args_signature_one_vector(arg_count),
        Function::Vlookup => args_signature_hlookup(arg_count),
        Function::Vstack => vec![Signature::Vector; arg_count],
        Function::Wrapcols => args_signature_wrapcols(arg_count),
        Function::Wraprows => args_signature_wrapcols(arg_count),
        Function::Xlookup => args_signature_xlookup(arg_count),
        Function::Xmatch => args_signature_xmatch(arg_count),
        Function::Trimrange => args_signature_trimrange(arg_count),
        Function::Sort => args_signature_sort(arg_count),
        Function::Sortby => args_signature_sortby(arg_count),
        Function::Unique => args_signature_unique(arg_count),
        Function::Filter => args_signature_filter(arg_count),
        Function::Take => args_signature_take(arg_count),
        Function::Drop => args_signature_drop(arg_count),
        Function::Tocol => args_signature_tocol(arg_count),
        Function::Torow => args_signature_tocol(arg_count),
        Function::Transpose => args_signature_one_vector(arg_count),
        Function::Mmult => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::Bycol => args_signature_bycol_byrow(arg_count),
        Function::Byrow => args_signature_bycol_byrow(arg_count),
        Function::Map => args_signature_map(arg_count),
        Function::Reduce => args_signature_reduce(arg_count),
        Function::Scan => args_signature_scan(arg_count),
        Function::Makearray => vec![Signature::Scalar; 3],
        Function::Sequence => args_signature_sequence(arg_count),
        Function::Randarray => args_signature_randarray(arg_count),
        Function::Textsplit => args_signature_textsplit(arg_count),
        Function::Concat => vec![Signature::Vector; arg_count],
        Function::Concatenate => vec![Signature::Scalar; arg_count],
        Function::Exact => args_signature_scalars(arg_count, 2, 0),
        Function::Find => args_signature_scalars(arg_count, 2, 1),
        Function::Left => args_signature_scalars(arg_count, 1, 1),
        Function::Len => args_signature_scalars(arg_count, 1, 0),
        Function::Lower => args_signature_scalars(arg_count, 1, 0),
        Function::Mid => args_signature_scalars(arg_count, 3, 0),
        Function::Rept => args_signature_scalars(arg_count, 2, 0),
        Function::Right => args_signature_scalars(arg_count, 2, 1),
        Function::Search => args_signature_scalars(arg_count, 2, 1),
        Function::Substitute => args_signature_scalars(arg_count, 3, 1),
        Function::Regexextract => args_signature_scalars(arg_count, 2, 1),
        Function::Regexreplace => args_signature_scalars(arg_count, 3, 0),
        Function::Regextest => args_signature_scalars(arg_count, 2, 0),
        Function::T => args_signature_scalars(arg_count, 1, 0),
        Function::Text => args_signature_scalars(arg_count, 2, 0),
        Function::Textafter => args_signature_textafter(arg_count),
        Function::Textbefore => args_signature_textafter(arg_count),
        Function::Textjoin => args_signature_textjoin(arg_count),
        Function::Trim => args_signature_scalars(arg_count, 1, 0),
        Function::Upper => args_signature_scalars(arg_count, 1, 0),
        Function::Value => args_signature_scalars(arg_count, 1, 0),
        Function::Valuetotext => args_signature_scalars(arg_count, 1, 1),
        Function::Average => vec![Signature::Vector; arg_count],
        Function::Avedev => vec![Signature::Vector; arg_count],
        Function::Averagea => vec![Signature::Vector; arg_count],
        Function::Averageif => args_signature_sumif(arg_count),
        Function::Averageifs => vec![Signature::Vector; arg_count],
        Function::Count => vec![Signature::Vector; arg_count],
        Function::Counta => vec![Signature::Vector; arg_count],
        Function::Countblank => vec![Signature::Vector; arg_count],
        Function::Countif => args_signature_sumif(arg_count),
        Function::Countifs => vec![Signature::Vector; arg_count],
        Function::Maxifs => vec![Signature::Vector; arg_count],
        Function::Minifs => vec![Signature::Vector; arg_count],
        Function::Date => args_signature_scalars(arg_count, 3, 0),
        Function::Datedif => args_signature_scalars(arg_count, 3, 0),
        Function::Datevalue => args_signature_scalars(arg_count, 1, 0),
        Function::Day => args_signature_scalars(arg_count, 1, 0),
        Function::Edate => args_signature_scalars(arg_count, 2, 0),
        Function::Eomonth => args_signature_scalars(arg_count, 2, 0),
        Function::Month => args_signature_scalars(arg_count, 1, 0),
        Function::Time => args_signature_scalars(arg_count, 3, 0),
        Function::Timevalue => args_signature_scalars(arg_count, 1, 0),
        Function::Hour => args_signature_scalars(arg_count, 1, 0),
        Function::Minute => args_signature_scalars(arg_count, 1, 0),
        Function::Second => args_signature_scalars(arg_count, 1, 0),
        Function::Now => args_signature_no_args(arg_count),
        Function::Today => args_signature_no_args(arg_count),
        Function::Year => args_signature_scalars(arg_count, 1, 0),
        Function::Days => args_signature_scalars(arg_count, 2, 0),
        Function::Days360 => args_signature_scalars(arg_count, 2, 1),
        Function::Weekday => args_signature_scalars(arg_count, 1, 1),
        Function::Weeknum => args_signature_scalars(arg_count, 1, 1),
        Function::Workday => args_signature_scalars(arg_count, 2, 1),
        Function::WorkdayIntl => args_signature_scalars(arg_count, 2, 2),
        Function::Yearfrac => args_signature_scalars(arg_count, 2, 1),
        Function::Isoweeknum => args_signature_scalars(arg_count, 1, 0),
        Function::Accrint => args_signature_scalars(arg_count, 6, 2),
        Function::Accrintm => args_signature_scalars(arg_count, 3, 2),
        Function::Disc => args_signature_scalars(arg_count, 4, 1),
        Function::Fvschedule => vec![Signature::Scalar, Signature::Vector],
        Function::Intrate => args_signature_scalars(arg_count, 4, 1),
        Function::Pricedisc => args_signature_scalars(arg_count, 4, 1),
        Function::Pricemat => args_signature_scalars(arg_count, 5, 1),
        Function::Received => args_signature_scalars(arg_count, 4, 1),
        Function::Yielddisc => args_signature_scalars(arg_count, 4, 1),
        Function::Yieldmat => args_signature_scalars(arg_count, 5, 1),
        Function::Cumipmt => args_signature_scalars(arg_count, 6, 0),
        Function::Cumprinc => args_signature_scalars(arg_count, 6, 0),
        Function::Db => args_signature_scalars(arg_count, 4, 1),
        Function::Ddb => args_signature_scalars(arg_count, 4, 1),
        Function::Dollarde => args_signature_scalars(arg_count, 2, 0),
        Function::Dollarfr => args_signature_scalars(arg_count, 2, 0),
        Function::Effect => args_signature_scalars(arg_count, 2, 0),
        Function::Fv => args_signature_scalars(arg_count, 3, 2),
        Function::Ipmt => args_signature_scalars(arg_count, 4, 2),
        Function::Irr => args_signature_irr(arg_count),
        Function::Ispmt => args_signature_scalars(arg_count, 4, 0),
        Function::Mirr => args_signature_mirr(arg_count),
        Function::Nominal => args_signature_scalars(arg_count, 2, 0),
        Function::Nper => args_signature_scalars(arg_count, 3, 2),
        Function::Npv => args_signature_npv(arg_count),
        Function::Pduration => args_signature_scalars(arg_count, 3, 0),
        Function::Pmt => args_signature_scalars(arg_count, 3, 2),
        Function::Ppmt => args_signature_scalars(arg_count, 4, 2),
        Function::Pv => args_signature_scalars(arg_count, 3, 2),
        Function::Rate => args_signature_scalars(arg_count, 3, 3),
        Function::Rri => args_signature_scalars(arg_count, 3, 0),
        Function::Sln => args_signature_scalars(arg_count, 3, 0),
        Function::Syd => args_signature_scalars(arg_count, 4, 0),
        Function::Tbilleq => args_signature_scalars(arg_count, 3, 0),
        Function::Tbillprice => args_signature_scalars(arg_count, 3, 0),
        Function::Tbillyield => args_signature_scalars(arg_count, 3, 0),
        Function::Xirr => args_signature_xirr(arg_count),
        Function::Xnpv => args_signature_xnpv(arg_count),
        Function::Duration => args_signature_scalars(arg_count, 5, 1),
        Function::Mduration => args_signature_scalars(arg_count, 5, 1),
        Function::Price => args_signature_scalars(arg_count, 6, 1),
        Function::Yield => args_signature_scalars(arg_count, 6, 1),
        Function::Oddfprice => args_signature_scalars(arg_count, 8, 1),
        Function::Oddfyield => args_signature_scalars(arg_count, 8, 1),
        Function::Oddlprice => args_signature_scalars(arg_count, 7, 1),
        Function::Oddlyield => args_signature_scalars(arg_count, 7, 1),
        Function::Coupdaybs => args_signature_scalars(arg_count, 3, 1),
        Function::Coupdays => args_signature_scalars(arg_count, 3, 1),
        Function::Coupdaysnc => args_signature_scalars(arg_count, 3, 1),
        Function::Coupncd => args_signature_scalars(arg_count, 3, 1),
        Function::Coupnum => args_signature_scalars(arg_count, 3, 1),
        Function::Couppcd => args_signature_scalars(arg_count, 3, 1),
        Function::Amordegrc => args_signature_scalars(arg_count, 6, 1),
        Function::Amorlinc => args_signature_scalars(arg_count, 6, 1),
        Function::Vdb => args_signature_scalars(arg_count, 5, 2),
        Function::Besseli => args_signature_scalars(arg_count, 2, 0),
        Function::Besselj => args_signature_scalars(arg_count, 2, 0),
        Function::Besselk => args_signature_scalars(arg_count, 2, 0),
        Function::Bessely => args_signature_scalars(arg_count, 2, 0),
        Function::Erf => args_signature_scalars(arg_count, 1, 1),
        Function::Erfc => args_signature_scalars(arg_count, 1, 0),
        Function::ErfcPrecise => args_signature_scalars(arg_count, 1, 0),
        Function::ErfPrecise => args_signature_scalars(arg_count, 1, 0),
        Function::Bin2dec => args_signature_scalars(arg_count, 1, 0),
        Function::Bin2hex => args_signature_scalars(arg_count, 1, 0),
        Function::Bin2oct => args_signature_scalars(arg_count, 1, 0),
        Function::Dec2Bin => args_signature_scalars(arg_count, 1, 0),
        Function::Dec2hex => args_signature_scalars(arg_count, 1, 0),
        Function::Dec2oct => args_signature_scalars(arg_count, 1, 0),
        Function::Hex2bin => args_signature_scalars(arg_count, 1, 0),
        Function::Hex2dec => args_signature_scalars(arg_count, 1, 0),
        Function::Hex2oct => args_signature_scalars(arg_count, 1, 0),
        Function::Oct2bin => args_signature_scalars(arg_count, 1, 0),
        Function::Oct2dec => args_signature_scalars(arg_count, 1, 0),
        Function::Oct2hex => args_signature_scalars(arg_count, 1, 0),
        Function::Bitand => args_signature_scalars(arg_count, 2, 0),
        Function::Bitlshift => args_signature_scalars(arg_count, 2, 0),
        Function::Bitor => args_signature_scalars(arg_count, 2, 0),
        Function::Bitrshift => args_signature_scalars(arg_count, 2, 0),
        Function::Bitxor => args_signature_scalars(arg_count, 2, 0),
        Function::Complex => args_signature_scalars(arg_count, 2, 1),
        Function::Imabs => args_signature_scalars(arg_count, 1, 0),
        Function::Imaginary => args_signature_scalars(arg_count, 1, 0),
        Function::Imargument => args_signature_scalars(arg_count, 1, 0),
        Function::Imconjugate => args_signature_scalars(arg_count, 1, 0),
        Function::Imcos => args_signature_scalars(arg_count, 1, 0),
        Function::Imcosh => args_signature_scalars(arg_count, 1, 0),
        Function::Imcot => args_signature_scalars(arg_count, 1, 0),
        Function::Imcsc => args_signature_scalars(arg_count, 1, 0),
        Function::Imcsch => args_signature_scalars(arg_count, 1, 0),
        Function::Imdiv => args_signature_scalars(arg_count, 2, 0),
        Function::Imexp => args_signature_scalars(arg_count, 1, 0),
        Function::Imln => args_signature_scalars(arg_count, 1, 0),
        Function::Imlog10 => args_signature_scalars(arg_count, 1, 0),
        Function::Imlog2 => args_signature_scalars(arg_count, 1, 0),
        Function::Impower => args_signature_scalars(arg_count, 2, 0),
        Function::Improduct => args_signature_scalars(arg_count, 2, 0),
        Function::Imreal => args_signature_scalars(arg_count, 1, 0),
        Function::Imsec => args_signature_scalars(arg_count, 1, 0),
        Function::Imsech => args_signature_scalars(arg_count, 1, 0),
        Function::Imsin => args_signature_scalars(arg_count, 1, 0),
        Function::Imsinh => args_signature_scalars(arg_count, 1, 0),
        Function::Imsqrt => args_signature_scalars(arg_count, 1, 0),
        Function::Imsub => args_signature_scalars(arg_count, 2, 0),
        Function::Imsum => args_signature_scalars(arg_count, 2, 0),
        Function::Imtan => args_signature_scalars(arg_count, 1, 0),
        Function::Convert => args_signature_scalars(arg_count, 3, 0),
        Function::Delta => args_signature_scalars(arg_count, 1, 1),
        Function::Gestep => args_signature_scalars(arg_count, 1, 1),
        Function::Subtotal => args_signature_npv(arg_count),
        // MACRO: the options and function number are single values.
        Function::Aggregate => {
            let mut result = vec![Signature::Vector; arg_count];
            result
                .iter_mut()
                .take(2)
                .for_each(|s| *s = Signature::Scalar);
            result
        }
        Function::Rand => args_signature_no_args(arg_count),
        Function::Randbetween => args_signature_scalars(arg_count, 2, 0),
        Function::Formulatext => args_signature_scalars(arg_count, 1, 0),
        Function::Unicode => args_signature_scalars(arg_count, 1, 0),
        Function::Unichar => args_signature_scalars(arg_count, 1, 0),
        Function::Char => args_signature_scalars(arg_count, 1, 0),
        Function::Clean => args_signature_scalars(arg_count, 1, 0),
        Function::Code => args_signature_scalars(arg_count, 1, 0),
        Function::Asc => args_signature_scalars(arg_count, 1, 0),
        Function::Arraytotext => args_signature_arraytotext(arg_count),
        Function::Dollar => args_signature_scalars(arg_count, 1, 1),
        Function::Encodeurl => args_signature_scalars(arg_count, 1, 0),
        Function::Findb => args_signature_scalars(arg_count, 2, 1),
        Function::Fixed => args_signature_scalars(arg_count, 1, 2),
        Function::Leftb => args_signature_scalars(arg_count, 1, 1),
        Function::Lenb => args_signature_scalars(arg_count, 1, 0),
        Function::Midb => args_signature_scalars(arg_count, 3, 0),
        Function::Numbervalue => args_signature_scalars(arg_count, 1, 2),
        Function::Proper => args_signature_scalars(arg_count, 1, 0),
        Function::Replace => args_signature_scalars(arg_count, 4, 0),
        Function::Replaceb => args_signature_scalars(arg_count, 4, 0),
        Function::Rightb => args_signature_scalars(arg_count, 1, 1),
        Function::Searchb => args_signature_scalars(arg_count, 2, 1),
        Function::Geomean => vec![Signature::Vector; arg_count],
        Function::Networkdays => args_signature_networkdays(arg_count),
        Function::NetworkdaysIntl => args_signature_networkdays_intl(arg_count),
        Function::Acot => args_signature_scalars(arg_count, 1, 0),
        Function::Acoth => args_signature_scalars(arg_count, 1, 0),
        Function::Cot => args_signature_scalars(arg_count, 1, 0),
        Function::Coth => args_signature_scalars(arg_count, 1, 0),
        Function::Csc => args_signature_scalars(arg_count, 1, 0),
        Function::Csch => args_signature_scalars(arg_count, 1, 0),
        Function::Sec => args_signature_scalars(arg_count, 1, 0),
        Function::Sech => args_signature_scalars(arg_count, 1, 0),
        Function::Exp => args_signature_scalars(arg_count, 1, 0),
        Function::Fact => args_signature_scalars(arg_count, 1, 0),
        Function::Factdouble => args_signature_scalars(arg_count, 1, 0),
        Function::Sign => args_signature_scalars(arg_count, 1, 0),
        Function::Radians => args_signature_scalars(arg_count, 1, 0),
        Function::Degrees => args_signature_scalars(arg_count, 1, 0),
        Function::Int => args_signature_scalars(arg_count, 1, 0),
        Function::Even => args_signature_scalars(arg_count, 1, 0),
        Function::Odd => args_signature_scalars(arg_count, 1, 0),
        Function::Ceiling => args_signature_scalars(arg_count, 2, 0),
        Function::CeilingMath => args_signature_scalars(arg_count, 1, 2),
        Function::CeilingPrecise => args_signature_scalars(arg_count, 1, 1),
        Function::Floor => args_signature_scalars(arg_count, 2, 0),
        Function::FloorMath => args_signature_scalars(arg_count, 1, 2),
        Function::FloorPrecise => args_signature_scalars(arg_count, 1, 1),
        Function::IsoCeiling => args_signature_scalars(arg_count, 1, 1),
        Function::Mod => args_signature_scalars(arg_count, 2, 0),
        Function::Quotient => args_signature_scalars(arg_count, 2, 0),
        Function::Mround => args_signature_scalars(arg_count, 2, 0),
        Function::Trunc => args_signature_scalars(arg_count, 1, 1),
        Function::Gcd => vec![Signature::Vector; arg_count],
        Function::Lcm => vec![Signature::Vector; arg_count],
        Function::Base => args_signature_scalars(arg_count, 2, 1),
        Function::Decimal => args_signature_scalars(arg_count, 2, 0),
        Function::Roman => args_signature_scalars(arg_count, 1, 1),
        Function::Arabic => args_signature_scalars(arg_count, 1, 0),
        Function::Combin => args_signature_scalars(arg_count, 2, 0),
        Function::Combina => args_signature_scalars(arg_count, 2, 0),
        Function::Sumsq => vec![Signature::Vector; arg_count],
        Function::Mdeterm => args_signature_one_vector(arg_count),
        Function::Minverse => args_signature_one_vector(arg_count),
        Function::Munit => args_signature_scalars(arg_count, 1, 0),
        Function::Multinomial => vec![Signature::Vector; arg_count],
        Function::Seriessum => {
            if arg_count == 4 {
                vec![
                    Signature::Scalar,
                    Signature::Scalar,
                    Signature::Scalar,
                    Signature::Vector,
                ]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::Sumproduct => vec![Signature::Vector; arg_count],
        Function::Percentof => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::N => args_signature_scalars(arg_count, 1, 0),
        Function::Sheets => args_signature_scalars(arg_count, 0, 1),
        Function::Cell => args_signature_scalars(arg_count, 1, 1),
        Function::Info => args_signature_scalars(arg_count, 1, 1),
        Function::Daverage => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dcount => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dget => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dmax => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dmin => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dsum => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dcounta => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dproduct => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dstdev => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dvar => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dvarp => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::Dstdevp => vec![Signature::Vector, Signature::Scalar, Signature::Vector],
        Function::BetaDist => args_signature_scalars(arg_count, 4, 2),
        Function::BetaInv => args_signature_scalars(arg_count, 3, 2),
        Function::BinomDist => args_signature_scalars(arg_count, 4, 0),
        Function::BinomDistRange => args_signature_scalars(arg_count, 3, 1),
        Function::BinomInv => args_signature_scalars(arg_count, 3, 0),
        Function::ChisqDist => args_signature_scalars(arg_count, 4, 0),
        Function::ChisqDistRT => args_signature_scalars(arg_count, 3, 0),
        Function::ChisqInv => args_signature_scalars(arg_count, 3, 0),
        Function::ChisqInvRT => args_signature_scalars(arg_count, 2, 0),
        Function::ChisqTest => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::ConfidenceNorm => args_signature_scalars(arg_count, 3, 0),
        Function::ConfidenceT => args_signature_scalars(arg_count, 3, 0),
        Function::CovarianceP => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::CovarianceS => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::Devsq => vec![Signature::Vector; arg_count],
        Function::ExponDist => args_signature_scalars(arg_count, 3, 0),
        Function::FDist => args_signature_scalars(arg_count, 4, 0),
        Function::FDistRT => args_signature_scalars(arg_count, 3, 0),
        Function::FInv => args_signature_scalars(arg_count, 3, 0),
        Function::FInvRT => args_signature_scalars(arg_count, 3, 0),
        Function::FTest => vec![Signature::Vector; 2],
        Function::Fisher => args_signature_scalars(arg_count, 1, 0),
        Function::FisherInv => args_signature_scalars(arg_count, 1, 0),
        Function::Gamma => args_signature_scalars(arg_count, 1, 0),
        Function::GammaDist => args_signature_scalars(arg_count, 4, 0),
        Function::GammaInv => args_signature_scalars(arg_count, 3, 0),
        Function::GammaLn => args_signature_scalars(arg_count, 1, 0),
        Function::GammaLnPrecise => args_signature_scalars(arg_count, 1, 0),
        Function::HypGeomDist => args_signature_scalars(arg_count, 5, 0),
        Function::LogNormDist => args_signature_scalars(arg_count, 4, 0),
        Function::LogNormInv => args_signature_scalars(arg_count, 3, 0),
        Function::NegbinomDist => args_signature_scalars(arg_count, 4, 0),
        Function::NormDist => args_signature_scalars(arg_count, 4, 0),
        Function::NormInv => args_signature_scalars(arg_count, 3, 0),
        Function::NormSdist => args_signature_scalars(arg_count, 2, 0),
        Function::NormSInv => args_signature_scalars(arg_count, 1, 0),
        Function::Pearson => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::Phi => args_signature_scalars(arg_count, 1, 0),
        Function::PoissonDist => args_signature_scalars(arg_count, 3, 0),
        Function::Standardize => args_signature_scalars(arg_count, 3, 0),
        Function::Stdev => vec![Signature::Vector; arg_count],
        Function::StDevP => vec![Signature::Vector; arg_count],
        Function::StDevS => vec![Signature::Vector; arg_count],
        Function::Stdeva => vec![Signature::Vector; arg_count],
        Function::Stdevpa => vec![Signature::Vector; arg_count],
        Function::TDist => args_signature_scalars(arg_count, 3, 0),
        Function::TDist2T => args_signature_scalars(arg_count, 2, 0),
        Function::TDistRT => args_signature_scalars(arg_count, 2, 0),
        Function::TInv => args_signature_scalars(arg_count, 2, 0),
        Function::TInv2T => args_signature_scalars(arg_count, 2, 0),
        Function::TTest => {
            if arg_count == 4 {
                vec![
                    Signature::Vector,
                    Signature::Vector,
                    Signature::Scalar,
                    Signature::Scalar,
                ]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::VarP => vec![Signature::Vector; arg_count],
        Function::VarS => vec![Signature::Vector; arg_count],
        Function::VarpA => vec![Signature::Vector; arg_count],
        Function::VarA => vec![Signature::Vector; arg_count],
        Function::WeibullDist => args_signature_scalars(arg_count, 4, 0),
        Function::ZTest => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Scalar]
            } else if arg_count == 3 {
                vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        // Compatibility wrappers
        Function::BetaDistCompat => args_signature_scalars(arg_count, 3, 2),
        Function::HypGeomDistCompat => args_signature_scalars(arg_count, 4, 0),
        Function::LogNormDistCompat => args_signature_scalars(arg_count, 3, 0),
        Function::NegbinomDistCompat => args_signature_scalars(arg_count, 3, 0),
        Function::NormSDistCompat => args_signature_scalars(arg_count, 1, 0),
        Function::TDistCompat => args_signature_scalars(arg_count, 3, 0),
        // Compatibility aliases
        Function::BetaInvCompat => args_signature_scalars(arg_count, 3, 2),
        Function::BinomDistCompat => args_signature_scalars(arg_count, 4, 0),
        Function::ChiDistCompat => args_signature_scalars(arg_count, 2, 0),
        Function::ChiInvCompat => args_signature_scalars(arg_count, 2, 0),
        Function::ChiTestCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::ConfidenceCompat => args_signature_scalars(arg_count, 3, 0),
        Function::CovarCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Vector]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::CritbinomCompat => args_signature_scalars(arg_count, 3, 0),
        Function::ExponDistCompat => args_signature_scalars(arg_count, 3, 0),
        Function::FDistCompat => args_signature_scalars(arg_count, 3, 0),
        Function::FInvCompat => args_signature_scalars(arg_count, 3, 0),
        Function::FTestCompat => vec![Signature::Vector; 2],
        Function::GammaDistCompat => args_signature_scalars(arg_count, 4, 0),
        Function::GammaInvCompat => args_signature_scalars(arg_count, 3, 0),
        Function::LoginvCompat => args_signature_scalars(arg_count, 3, 0),
        Function::ModeCompat => vec![Signature::Vector; arg_count],
        Function::NormDistCompat => args_signature_scalars(arg_count, 4, 0),
        Function::NormInvCompat => args_signature_scalars(arg_count, 3, 0),
        Function::NormSInvCompat => args_signature_scalars(arg_count, 1, 0),
        Function::PercentileCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Scalar]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::PercentrankCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Scalar]
            } else if arg_count == 3 {
                vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::PoissonCompat => args_signature_scalars(arg_count, 3, 0),
        Function::QuartileCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Scalar]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::RankCompat => vec![Signature::Scalar, Signature::Vector, Signature::Scalar],
        Function::StDevPCompat => vec![Signature::Vector; arg_count],
        Function::TInvCompat => args_signature_scalars(arg_count, 2, 0),
        Function::TTestCompat => {
            if arg_count == 4 {
                vec![
                    Signature::Vector,
                    Signature::Vector,
                    Signature::Scalar,
                    Signature::Scalar,
                ]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::VarCompat => vec![Signature::Vector; arg_count],
        Function::VarPCompat => vec![Signature::Vector; arg_count],
        Function::WeibullCompat => args_signature_scalars(arg_count, 4, 0),
        Function::ZTestCompat => {
            if arg_count == 2 {
                vec![Signature::Vector, Signature::Scalar]
            } else if arg_count == 3 {
                vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
            } else {
                vec![Signature::Error; arg_count]
            }
        }
        Function::Sumx2my2 => vec![Signature::Vector; 2],
        Function::Sumx2py2 => vec![Signature::Vector; 2],
        Function::Sumxmy2 => vec![Signature::Vector; 2],
        Function::Correl => vec![Signature::Vector; 2],
        Function::Rsq => vec![Signature::Vector; 2],
        Function::Intercept => vec![Signature::Vector; 2],
        Function::Slope => vec![Signature::Vector; 2],
        Function::Steyx => vec![Signature::Vector; 2],
        Function::Forecast | Function::ForecastLinear => {
            vec![Signature::Scalar, Signature::Vector, Signature::Vector]
        }
        Function::ForecastEts
        | Function::ForecastEtsConfint
        | Function::ForecastEtsSeasonality
        | Function::ForecastEtsStat => vec![Signature::Vector; arg_count],
        Function::Frequency => vec![Signature::Vector, Signature::Vector],
        Function::Growth | Function::Trend => match arg_count {
            1 => vec![Signature::Vector],
            2 => vec![Signature::Vector, Signature::Vector],
            3 => vec![Signature::Vector, Signature::Vector, Signature::Vector],
            4 => vec![
                Signature::Vector,
                Signature::Vector,
                Signature::Vector,
                Signature::Scalar,
            ],
            _ => vec![Signature::Error; arg_count],
        },
        Function::Linest | Function::Logest => match arg_count {
            1 => vec![Signature::Vector],
            2 => vec![Signature::Vector, Signature::Vector],
            3 => vec![Signature::Vector, Signature::Vector, Signature::Scalar],
            4 => vec![
                Signature::Vector,
                Signature::Vector,
                Signature::Scalar,
                Signature::Scalar,
            ],
            _ => vec![Signature::Error; arg_count],
        },
        Function::ModeMult | Function::ModeSingl => vec![Signature::Vector; arg_count],
        Function::PercentileExc | Function::PercentileInc => {
            vec![Signature::Vector, Signature::Scalar]
        }
        Function::PercentrankExc | Function::PercentrankInc => {
            vec![Signature::Vector, Signature::Scalar, Signature::Scalar]
        }
        Function::Permut | Function::Permutationa => vec![Signature::Scalar; 2],
        Function::Prob => match arg_count {
            3 => vec![Signature::Vector, Signature::Vector, Signature::Scalar],
            4 => vec![
                Signature::Vector,
                Signature::Vector,
                Signature::Scalar,
                Signature::Scalar,
            ],
            _ => vec![Signature::Error; arg_count],
        },
        Function::QuartileExc | Function::QuartileInc => {
            vec![Signature::Vector, Signature::Scalar]
        }
        Function::Trimmean => vec![Signature::Vector, Signature::Scalar],
        Function::Gauss => args_signature_scalars(arg_count, 1, 0),
        Function::Harmean => vec![Signature::Vector; arg_count],
        Function::Kurt => vec![Signature::Vector; arg_count],
        Function::Large => vec![Signature::Vector, Signature::Scalar],
        Function::MaxA => vec![Signature::Vector; arg_count],
        Function::Median => vec![Signature::Vector; arg_count],
        Function::MinA => vec![Signature::Vector; arg_count],
        Function::RankAvg => vec![Signature::Scalar, Signature::Vector, Signature::Scalar],
        Function::RankEq => vec![Signature::Scalar, Signature::Vector, Signature::Scalar],
        Function::Skew => vec![Signature::Vector; arg_count],
        Function::SkewP => vec![Signature::Vector; arg_count],
        Function::Small => vec![Signature::Vector, Signature::Scalar],
    }
}

// Returns the type of the result (Scalar, Array or Range) depending on the arguments
fn static_analysis_on_function(kind: &Function, args: &[Node]) -> StaticResult {
    match kind {
        Function::And => StaticResult::Scalar,
        Function::False => StaticResult::Scalar,
        Function::If => scalar_arguments(args),
        Function::Iferror => scalar_arguments(args),
        Function::Ifna => scalar_arguments(args),
        Function::Ifs => not_implemented(args),
        Function::Lambda => StaticResult::Unknown,
        Function::Let => StaticResult::Unknown,
        Function::Not => StaticResult::Scalar,
        Function::Or => StaticResult::Scalar,
        Function::Switch => not_implemented(args),
        Function::True => StaticResult::Scalar,
        Function::Xor => StaticResult::Scalar,
        Function::Abs => scalar_arguments(args),
        Function::Acos => scalar_arguments(args),
        Function::Acosh => scalar_arguments(args),
        Function::Asin => scalar_arguments(args),
        Function::Asinh => scalar_arguments(args),
        Function::Atan => scalar_arguments(args),
        Function::Atan2 => scalar_arguments(args),
        Function::Atanh => scalar_arguments(args),
        // CHOOSE is a reference function: with a range arm the call itself is
        // reference-shaped, so legacy import wraps the whole CALL in `@`
        // (Excel upgrades `=CHOOSE(2,A1:A10,B1:B10)` to `=@CHOOSE(...)`).
        Function::Choose => match scalar_arguments(args) {
            StaticResult::Array(n, m) => StaticResult::Range(n, m),
            other => other,
        },
        Function::Column => static_analysis_row_column(args, false),
        Function::Columns => not_implemented(args),
        Function::Cos => scalar_arguments(args),
        Function::Cosh => scalar_arguments(args),
        Function::Max => StaticResult::Scalar,
        Function::Min => StaticResult::Scalar,
        Function::Pi => StaticResult::Scalar,
        Function::Power => scalar_arguments(args),
        Function::Product => not_implemented(args),
        Function::Round => scalar_arguments(args),
        Function::Rounddown => scalar_arguments(args),
        Function::Roundup => scalar_arguments(args),
        Function::Ln => scalar_arguments(args),
        Function::Log => scalar_arguments(args),
        Function::Log10 => scalar_arguments(args),
        Function::Sin => scalar_arguments(args),
        Function::Sinh => scalar_arguments(args),
        Function::Sqrt => scalar_arguments(args),
        Function::Sqrtpi => StaticResult::Scalar,
        Function::Sum => StaticResult::Scalar,
        Function::Sumif => sumif_static_result(args),
        Function::Sumifs => not_implemented(args),
        Function::Tan => scalar_arguments(args),
        Function::Tanh => scalar_arguments(args),
        Function::ErrorType => not_implemented(args),
        Function::Isblank => not_implemented(args),
        Function::Iserr => not_implemented(args),
        Function::Iserror => not_implemented(args),
        Function::Iseven => not_implemented(args),
        Function::Isformula => not_implemented(args),
        Function::Islogical => not_implemented(args),
        Function::Isna => not_implemented(args),
        Function::Isnontext => not_implemented(args),
        Function::Isnumber => not_implemented(args),
        Function::Isodd => not_implemented(args),
        Function::Isomitted => not_implemented(args),
        Function::Isref => not_implemented(args),
        Function::Istext => not_implemented(args),
        Function::Na => StaticResult::Scalar,
        Function::Sheet => StaticResult::Scalar,
        Function::Type => not_implemented(args),
        Function::Address => not_implemented(args),
        Function::Areas => StaticResult::Scalar,
        Function::Choosecols => StaticResult::Unknown,
        Function::Chooserows => StaticResult::Unknown,
        Function::Expand => StaticResult::Unknown,
        Function::Hlookup => not_implemented(args),
        Function::Hstack => StaticResult::Unknown,
        Function::Hyperlink => StaticResult::Scalar,
        Function::Index => static_analysis_index(args),
        Function::Indirect => static_analysis_indirect(args),
        Function::Lookup => not_implemented(args),
        Function::Match => not_implemented(args),
        Function::Offset => static_analysis_offset(args),
        Function::Row => static_analysis_row_column(args, true),
        Function::Rows => not_implemented(args),
        Function::Vlookup => not_implemented(args),
        Function::Vstack => StaticResult::Unknown,
        Function::Wrapcols => StaticResult::Unknown,
        Function::Wraprows => StaticResult::Unknown,
        Function::Xlookup => static_analysis_xlookup(args), // MACRO
        Function::Xmatch => not_implemented(args),
        Function::Trimrange => StaticResult::Unknown,
        Function::Sort => StaticResult::Unknown,
        Function::Sortby => StaticResult::Unknown,
        Function::Unique => StaticResult::Unknown,
        Function::Filter => StaticResult::Unknown,
        Function::Take => StaticResult::Unknown,
        Function::Drop => StaticResult::Unknown,
        Function::Tocol => StaticResult::Unknown,
        Function::Torow => StaticResult::Unknown,
        Function::Transpose => StaticResult::Unknown,
        Function::Mmult => StaticResult::Unknown,
        Function::Bycol => StaticResult::Unknown,
        Function::Byrow => StaticResult::Unknown,
        Function::Map => StaticResult::Unknown,
        Function::Reduce => StaticResult::Unknown,
        Function::Scan => StaticResult::Unknown,
        Function::Makearray => StaticResult::Unknown,
        Function::Sequence => StaticResult::Unknown,
        Function::Randarray => StaticResult::Unknown,
        Function::Textsplit => StaticResult::Unknown,
        Function::Concat => not_implemented(args),
        Function::Concatenate => not_implemented(args),
        Function::Exact => scalar_arguments(args),
        Function::Find => scalar_arguments(args),
        // LEFT/MID/RIGHT broadcast element-wise: an array/range argument yields an array.
        Function::Left => scalar_arguments(args),
        Function::Len => scalar_arguments(args),
        // UPPER/LOWER broadcast element-wise: an array/range argument yields an array.
        Function::Lower => scalar_arguments(args),
        Function::Mid => scalar_arguments(args),
        Function::Rept => scalar_arguments(args),
        Function::Right => scalar_arguments(args),
        Function::Search => scalar_arguments(args),
        Function::Substitute => scalar_arguments(args),
        Function::Regexextract => {
            if args.len() == 3 {
                StaticResult::Unknown
            } else {
                not_implemented(args)
            }
        }
        Function::Regexreplace => not_implemented(args),
        Function::Regextest => not_implemented(args),
        Function::T => not_implemented(args),
        Function::Text => scalar_arguments(args),
        Function::Textafter => not_implemented(args),
        Function::Textbefore => not_implemented(args),
        Function::Textjoin => not_implemented(args),
        Function::Trim => scalar_arguments(args),
        Function::Unicode => not_implemented(args),
        Function::Unichar => not_implemented(args),
        Function::Char => not_implemented(args),
        Function::Clean => scalar_arguments(args),
        Function::Code => not_implemented(args),
        Function::Asc => not_implemented(args),
        Function::Arraytotext => not_implemented(args),
        Function::Dollar => not_implemented(args),
        Function::Encodeurl => not_implemented(args),
        Function::Findb => not_implemented(args),
        Function::Fixed => not_implemented(args),
        Function::Leftb => not_implemented(args),
        Function::Lenb => not_implemented(args),
        Function::Midb => not_implemented(args),
        Function::Numbervalue => not_implemented(args),
        Function::Proper => scalar_arguments(args),
        Function::Replace => scalar_arguments(args),
        Function::Replaceb => not_implemented(args),
        Function::Rightb => not_implemented(args),
        Function::Searchb => not_implemented(args),
        Function::Upper => scalar_arguments(args),
        Function::Value => not_implemented(args),
        Function::Valuetotext => not_implemented(args),
        Function::Average => not_implemented(args),
        Function::Averagea => not_implemented(args),
        Function::Avedev => not_implemented(args),
        Function::Averageif => not_implemented(args),
        Function::Averageifs => not_implemented(args),
        Function::Count => not_implemented(args),
        Function::Counta => not_implemented(args),
        Function::Countblank => not_implemented(args),
        Function::Countif => not_implemented(args),
        Function::Countifs => not_implemented(args),
        Function::Maxifs => not_implemented(args),
        Function::Minifs => not_implemented(args),
        // DATE broadcasts element-wise: an array/range argument yields an array.
        Function::Date => scalar_arguments(args),
        Function::Datedif => not_implemented(args),
        Function::Datevalue => not_implemented(args),
        Function::Day => scalar_arguments(args),
        Function::Edate => not_implemented(args),
        Function::Month => scalar_arguments(args),
        Function::Time => not_implemented(args),
        Function::Timevalue => not_implemented(args),
        Function::Hour => not_implemented(args),
        Function::Minute => not_implemented(args),
        Function::Second => not_implemented(args),
        Function::Now => not_implemented(args),
        Function::Today => not_implemented(args),
        Function::Year => scalar_arguments(args),
        Function::Days => not_implemented(args),
        Function::Days360 => not_implemented(args),
        Function::Weekday => scalar_arguments(args),
        Function::Weeknum => not_implemented(args),
        Function::Workday => not_implemented(args),
        Function::WorkdayIntl => not_implemented(args),
        Function::Yearfrac => not_implemented(args),
        Function::Isoweeknum => scalar_arguments(args),
        Function::Accrint => scalar_arguments(args),
        Function::Accrintm => scalar_arguments(args),
        Function::Disc => StaticResult::Scalar,
        Function::Fvschedule => StaticResult::Scalar,
        Function::Intrate => StaticResult::Scalar,
        Function::Pricedisc => StaticResult::Scalar,
        Function::Pricemat => StaticResult::Scalar,
        Function::Received => StaticResult::Scalar,
        Function::Yielddisc => StaticResult::Scalar,
        Function::Yieldmat => StaticResult::Scalar,
        Function::Cumipmt => not_implemented(args),
        Function::Cumprinc => not_implemented(args),
        Function::Db => not_implemented(args),
        Function::Ddb => not_implemented(args),
        Function::Dollarde => not_implemented(args),
        Function::Dollarfr => not_implemented(args),
        Function::Effect => not_implemented(args),
        Function::Fv => not_implemented(args),
        Function::Ipmt => not_implemented(args),
        Function::Irr => not_implemented(args),
        Function::Ispmt => not_implemented(args),
        Function::Mirr => not_implemented(args),
        Function::Nominal => not_implemented(args),
        Function::Nper => not_implemented(args),
        Function::Npv => not_implemented(args),
        Function::Pduration => not_implemented(args),
        Function::Pmt => not_implemented(args),
        Function::Ppmt => not_implemented(args),
        Function::Pv => not_implemented(args),
        Function::Rate => not_implemented(args),
        Function::Rri => not_implemented(args),
        Function::Sln => not_implemented(args),
        Function::Syd => not_implemented(args),
        Function::Tbilleq => not_implemented(args),
        Function::Tbillprice => not_implemented(args),
        Function::Tbillyield => not_implemented(args),
        Function::Xirr => not_implemented(args),
        Function::Xnpv => not_implemented(args),
        Function::Duration => StaticResult::Scalar,
        Function::Mduration => StaticResult::Scalar,
        Function::Price => StaticResult::Scalar,
        Function::Yield => StaticResult::Scalar,
        Function::Oddfprice => StaticResult::Scalar,
        Function::Oddfyield => StaticResult::Scalar,
        Function::Oddlprice => StaticResult::Scalar,
        Function::Oddlyield => StaticResult::Scalar,
        Function::Coupdaybs => StaticResult::Scalar,
        Function::Coupdays => StaticResult::Scalar,
        Function::Coupdaysnc => StaticResult::Scalar,
        Function::Coupncd => StaticResult::Scalar,
        Function::Coupnum => StaticResult::Scalar,
        Function::Couppcd => StaticResult::Scalar,
        Function::Amordegrc => StaticResult::Scalar,
        Function::Amorlinc => StaticResult::Scalar,
        Function::Vdb => StaticResult::Scalar,
        Function::Besseli => scalar_arguments(args),
        Function::Besselj => scalar_arguments(args),
        Function::Besselk => scalar_arguments(args),
        Function::Bessely => scalar_arguments(args),
        Function::Erf => scalar_arguments(args),
        Function::Erfc => scalar_arguments(args),
        Function::ErfcPrecise => scalar_arguments(args),
        Function::ErfPrecise => scalar_arguments(args),
        Function::Bin2dec => scalar_arguments(args),
        Function::Bin2hex => scalar_arguments(args),
        Function::Bin2oct => scalar_arguments(args),
        Function::Dec2Bin => scalar_arguments(args),
        Function::Dec2hex => scalar_arguments(args),
        Function::Dec2oct => scalar_arguments(args),
        Function::Hex2bin => scalar_arguments(args),
        Function::Hex2dec => scalar_arguments(args),
        Function::Hex2oct => scalar_arguments(args),
        Function::Oct2bin => scalar_arguments(args),
        Function::Oct2dec => scalar_arguments(args),
        Function::Oct2hex => scalar_arguments(args),
        Function::Bitand => scalar_arguments(args),
        Function::Bitlshift => scalar_arguments(args),
        Function::Bitor => scalar_arguments(args),
        Function::Bitrshift => scalar_arguments(args),
        Function::Bitxor => scalar_arguments(args),
        Function::Complex => scalar_arguments(args),
        Function::Imabs => scalar_arguments(args),
        Function::Imaginary => scalar_arguments(args),
        Function::Imargument => scalar_arguments(args),
        Function::Imconjugate => scalar_arguments(args),
        Function::Imcos => scalar_arguments(args),
        Function::Imcosh => scalar_arguments(args),
        Function::Imcot => scalar_arguments(args),
        Function::Imcsc => scalar_arguments(args),
        Function::Imcsch => scalar_arguments(args),
        Function::Imdiv => scalar_arguments(args),
        Function::Imexp => scalar_arguments(args),
        Function::Imln => scalar_arguments(args),
        Function::Imlog10 => scalar_arguments(args),
        Function::Imlog2 => scalar_arguments(args),
        Function::Impower => scalar_arguments(args),
        Function::Improduct => scalar_arguments(args),
        Function::Imreal => scalar_arguments(args),
        Function::Imsec => scalar_arguments(args),
        Function::Imsech => scalar_arguments(args),
        Function::Imsin => scalar_arguments(args),
        Function::Imsinh => scalar_arguments(args),
        Function::Imsqrt => scalar_arguments(args),
        Function::Imsub => scalar_arguments(args),
        Function::Imsum => scalar_arguments(args),
        Function::Imtan => scalar_arguments(args),
        Function::Convert => not_implemented(args),
        Function::Delta => not_implemented(args),
        Function::Gestep => not_implemented(args),
        Function::Subtotal => not_implemented(args),
        Function::Aggregate => StaticResult::Scalar, // MACRO
        Function::Rand => not_implemented(args),
        Function::Randbetween => scalar_arguments(args),
        Function::Eomonth => scalar_arguments(args),
        Function::Formulatext => not_implemented(args),
        Function::Geomean => not_implemented(args),
        Function::Networkdays => not_implemented(args),
        Function::NetworkdaysIntl => not_implemented(args),
        Function::Acot => scalar_arguments(args),
        Function::Acoth => scalar_arguments(args),
        Function::Cot => scalar_arguments(args),
        Function::Coth => scalar_arguments(args),
        Function::Csc => scalar_arguments(args),
        Function::Csch => scalar_arguments(args),
        Function::Sec => scalar_arguments(args),
        Function::Sech => scalar_arguments(args),
        Function::Exp => scalar_arguments(args),
        Function::Fact => scalar_arguments(args),
        Function::Factdouble => scalar_arguments(args),
        Function::Sign => scalar_arguments(args),
        Function::Radians => scalar_arguments(args),
        Function::Degrees => scalar_arguments(args),
        Function::Int => scalar_arguments(args),
        Function::Even => scalar_arguments(args),
        Function::Odd => scalar_arguments(args),
        Function::Ceiling => scalar_arguments(args),
        Function::CeilingMath => scalar_arguments(args),
        Function::CeilingPrecise => scalar_arguments(args),
        Function::Floor => scalar_arguments(args),
        Function::FloorMath => scalar_arguments(args),
        Function::FloorPrecise => scalar_arguments(args),
        Function::IsoCeiling => scalar_arguments(args),
        Function::Mod => scalar_arguments(args),
        Function::Quotient => scalar_arguments(args),
        Function::Mround => scalar_arguments(args),
        Function::Trunc => scalar_arguments(args),
        Function::Gcd => StaticResult::Scalar,
        Function::Lcm => StaticResult::Scalar,
        Function::Base => scalar_arguments(args),
        Function::Decimal => scalar_arguments(args),
        Function::Roman => scalar_arguments(args),
        Function::Arabic => scalar_arguments(args),
        Function::Combin => scalar_arguments(args),
        Function::Combina => scalar_arguments(args),
        Function::Sumsq => StaticResult::Scalar,
        Function::Mdeterm => StaticResult::Scalar,
        Function::Minverse => StaticResult::Unknown,
        Function::Munit => StaticResult::Unknown,
        Function::Multinomial => StaticResult::Scalar,
        Function::Seriessum => StaticResult::Scalar,
        Function::Sumproduct => StaticResult::Scalar,
        Function::Percentof => StaticResult::Scalar,
        Function::N => scalar_arguments(args),
        Function::Sheets => scalar_arguments(args),
        Function::Cell => StaticResult::Unknown,
        Function::Info => StaticResult::Unknown,
        Function::Dget => not_implemented(args),
        Function::Dmax => not_implemented(args),
        Function::Dmin => not_implemented(args),
        Function::Dcount => not_implemented(args),
        Function::Daverage => not_implemented(args),
        Function::Dsum => not_implemented(args),
        Function::Dcounta => not_implemented(args),
        Function::Dproduct => not_implemented(args),
        Function::Dstdev => not_implemented(args),
        Function::Dvar => not_implemented(args),
        Function::Dvarp => not_implemented(args),
        Function::Dstdevp => not_implemented(args),
        Function::BetaDist => StaticResult::Scalar,
        Function::BetaInv => StaticResult::Scalar,
        Function::BinomDist => StaticResult::Scalar,
        Function::BinomDistRange => StaticResult::Scalar,
        Function::BinomInv => StaticResult::Scalar,
        Function::ChisqDist => StaticResult::Scalar,
        Function::ChisqDistRT => StaticResult::Scalar,
        Function::ChisqInv => StaticResult::Scalar,
        Function::ChisqInvRT => StaticResult::Scalar,
        Function::ChisqTest => StaticResult::Scalar,
        Function::ConfidenceNorm => StaticResult::Scalar,
        Function::ConfidenceT => StaticResult::Scalar,
        Function::CovarianceP => StaticResult::Scalar,
        Function::CovarianceS => StaticResult::Scalar,
        Function::Devsq => StaticResult::Scalar,
        Function::ExponDist => StaticResult::Scalar,
        Function::FDist => StaticResult::Scalar,
        Function::FDistRT => StaticResult::Scalar,
        Function::FInv => StaticResult::Scalar,
        Function::FInvRT => StaticResult::Scalar,
        Function::FTest => StaticResult::Scalar,
        Function::Fisher => StaticResult::Scalar,
        Function::FisherInv => StaticResult::Scalar,
        Function::Gamma => StaticResult::Scalar,
        Function::GammaDist => StaticResult::Scalar,
        Function::GammaInv => StaticResult::Scalar,
        Function::GammaLn => StaticResult::Scalar,
        Function::GammaLnPrecise => StaticResult::Scalar,
        Function::HypGeomDist => StaticResult::Scalar,
        Function::LogNormDist => StaticResult::Scalar,
        Function::LogNormInv => StaticResult::Scalar,
        Function::NegbinomDist => StaticResult::Scalar,
        Function::NormDist => StaticResult::Scalar,
        Function::NormInv => StaticResult::Scalar,
        Function::NormSdist => StaticResult::Scalar,
        Function::NormSInv => StaticResult::Scalar,
        Function::Pearson => StaticResult::Scalar,
        Function::Phi => StaticResult::Scalar,
        Function::PoissonDist => StaticResult::Scalar,
        Function::Standardize => StaticResult::Scalar,
        Function::Stdev => StaticResult::Scalar,
        Function::StDevP => StaticResult::Scalar,
        Function::StDevS => StaticResult::Scalar,
        Function::Stdeva => StaticResult::Scalar,
        Function::Stdevpa => StaticResult::Scalar,
        Function::TDist => StaticResult::Scalar,
        Function::TDist2T => StaticResult::Scalar,
        Function::TDistRT => StaticResult::Scalar,
        Function::TInv => StaticResult::Scalar,
        Function::TInv2T => StaticResult::Scalar,
        Function::TTest => StaticResult::Scalar,
        Function::VarP => StaticResult::Scalar,
        Function::VarS => StaticResult::Scalar,
        Function::VarpA => StaticResult::Scalar,
        Function::VarA => StaticResult::Scalar,
        Function::WeibullDist => StaticResult::Scalar,
        Function::ZTest => StaticResult::Scalar,
        Function::BetaDistCompat => StaticResult::Scalar,
        Function::HypGeomDistCompat => StaticResult::Scalar,
        Function::LogNormDistCompat => StaticResult::Scalar,
        Function::NegbinomDistCompat => StaticResult::Scalar,
        Function::NormSDistCompat => StaticResult::Scalar,
        Function::TDistCompat => StaticResult::Scalar,
        Function::BetaInvCompat => StaticResult::Scalar,
        Function::BinomDistCompat => StaticResult::Scalar,
        Function::ChiDistCompat => StaticResult::Scalar,
        Function::ChiInvCompat => StaticResult::Scalar,
        Function::ChiTestCompat => StaticResult::Scalar,
        Function::ConfidenceCompat => StaticResult::Scalar,
        Function::CovarCompat => StaticResult::Scalar,
        Function::CritbinomCompat => StaticResult::Scalar,
        Function::ExponDistCompat => StaticResult::Scalar,
        Function::FDistCompat => StaticResult::Scalar,
        Function::FInvCompat => StaticResult::Scalar,
        Function::FTestCompat => StaticResult::Scalar,
        Function::GammaDistCompat => StaticResult::Scalar,
        Function::GammaInvCompat => StaticResult::Scalar,
        Function::LoginvCompat => StaticResult::Scalar,
        Function::ModeCompat => StaticResult::Scalar,
        Function::NormDistCompat => StaticResult::Scalar,
        Function::NormInvCompat => StaticResult::Scalar,
        Function::NormSInvCompat => StaticResult::Scalar,
        Function::PercentileCompat => StaticResult::Scalar,
        Function::PercentrankCompat => StaticResult::Scalar,
        Function::PoissonCompat => StaticResult::Scalar,
        Function::QuartileCompat => StaticResult::Scalar,
        Function::RankCompat => StaticResult::Scalar,
        Function::StDevPCompat => StaticResult::Scalar,
        Function::TInvCompat => StaticResult::Scalar,
        Function::TTestCompat => StaticResult::Scalar,
        Function::VarCompat => StaticResult::Scalar,
        Function::VarPCompat => StaticResult::Scalar,
        Function::WeibullCompat => StaticResult::Scalar,
        Function::ZTestCompat => StaticResult::Scalar,
        Function::Sumx2my2 => StaticResult::Scalar,
        Function::Sumx2py2 => StaticResult::Scalar,
        Function::Sumxmy2 => StaticResult::Scalar,
        Function::Correl => StaticResult::Scalar,
        Function::Rsq => StaticResult::Scalar,
        Function::Intercept => StaticResult::Scalar,
        Function::Slope => StaticResult::Scalar,
        Function::Steyx => StaticResult::Scalar,
        Function::Forecast => StaticResult::Scalar,
        Function::ForecastLinear => StaticResult::Scalar,
        Function::ForecastEts => StaticResult::Scalar,
        Function::ForecastEtsConfint => StaticResult::Scalar,
        Function::ForecastEtsSeasonality => StaticResult::Scalar,
        Function::ForecastEtsStat => StaticResult::Scalar,
        // Spill-returning functions
        Function::Frequency => StaticResult::Unknown,
        Function::Growth => StaticResult::Unknown,
        Function::Linest => StaticResult::Unknown,
        Function::Logest => StaticResult::Unknown,
        Function::ModeMult => StaticResult::Unknown,
        Function::Trend => StaticResult::Unknown,
        // Scalar-returning functions
        Function::ModeSingl => StaticResult::Scalar,
        Function::PercentileExc => StaticResult::Scalar,
        Function::PercentileInc => StaticResult::Scalar,
        Function::PercentrankExc => StaticResult::Scalar,
        Function::PercentrankInc => StaticResult::Scalar,
        Function::Permut => StaticResult::Scalar,
        Function::Permutationa => StaticResult::Scalar,
        Function::Prob => StaticResult::Scalar,
        Function::QuartileExc => StaticResult::Scalar,
        Function::QuartileInc => StaticResult::Scalar,
        Function::Trimmean => StaticResult::Scalar,
        Function::Gauss => StaticResult::Scalar,
        Function::Harmean => StaticResult::Scalar,
        Function::Kurt => StaticResult::Scalar,
        Function::Large => StaticResult::Scalar,
        Function::MaxA => StaticResult::Scalar,
        Function::Median => StaticResult::Scalar,
        Function::MinA => StaticResult::Scalar,
        Function::RankAvg => StaticResult::Scalar,
        Function::RankEq => StaticResult::Scalar,
        Function::Skew => StaticResult::Scalar,
        Function::SkewP => StaticResult::Scalar,
        Function::Small => StaticResult::Scalar,
    }
}
