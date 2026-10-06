use std::collections::HashSet;

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    functions::Function,
    model::Model,
};

/// Recursively walks `node`, replacing every `NamedVariableKind { name, id: None }` whose
/// name matches `target` with `id: Some(id)`.
///
/// When a nested LET is encountered that binds the same name, the walk stops past that
/// pair's value expression — the inner LET will assign its own id for subsequent uses.
pub(super) fn assign_variable_ids(node: &mut Node, target: &str, id: u32) {
    match node {
        Node::NamedVariableKind { name, id: var_id } if name == target && var_id.is_none() => {
            *var_id = Some(id);
        }
        Node::NamedFunctionKind {
            name,
            id: var_id,
            args,
        } => {
            if name == target && var_id.is_none() {
                *var_id = Some(id);
            }
            for arg in args.iter_mut() {
                assign_variable_ids(arg, target, id);
            }
        }
        Node::FunctionKind { kind, args } => {
            if *kind == Function::Let {
                let n_pairs = (args.len().saturating_sub(1)) / 2;
                // Find the first pair index where the inner LET shadows `target`.
                let shadow_pair = (0..n_pairs).find(|&k| {
                    matches!(&args[2 * k], Node::NamedVariableKind { name, .. } if name == target)
                });
                for i in 0..args.len() {
                    // Odd indices are value expressions; the last (even) index is the body.
                    // Even indices that are not the last are name declarations — never patch.
                    let is_declaration = i % 2 == 0 && i < args.len() - 1;
                    if is_declaration {
                        continue;
                    }
                    // Beyond the shadow pair's own value expression the name is shadowed.
                    if let Some(k) = shadow_pair {
                        if i > 2 * k + 1 {
                            continue;
                        }
                    }
                    assign_variable_ids(&mut args[i], target, id);
                }
            } else {
                for arg in args.iter_mut() {
                    assign_variable_ids(arg, target, id);
                }
            }
        }
        Node::OpSumKind { left, right, .. }
        | Node::OpProductKind { left, right, .. }
        | Node::OpPowerKind { left, right, .. }
        | Node::CompareKind { left, right, .. }
        | Node::OpConcatenateKind { left, right } => {
            assign_variable_ids(left, target, id);
            assign_variable_ids(right, target, id);
        }
        Node::UnaryKind { right, .. } => assign_variable_ids(right, target, id),
        Node::ImplicitIntersection { child, .. } | Node::SpillRangeOperator { child } => {
            assign_variable_ids(child, target, id);
        }
        Node::OpRangeKind { left, right } => {
            assign_variable_ids(left, target, id);
            assign_variable_ids(right, target, id);
        }
        Node::LambdaDefKind { parameters, body } => {
            // If a LAMBDA parameter shadows `target`, don't recurse into the body.
            let shadowed = parameters.iter().any(|p| p.name == target);
            if !shadowed {
                assign_variable_ids(body, target, id);
            }
        }
        Node::LambdaCallKind { lambda, args } => {
            assign_variable_ids(lambda, target, id);
            for arg in args.iter_mut() {
                assign_variable_ids(arg, target, id);
            }
        }
        _ => {}
    }
}

impl<'a> Model<'a> {
    pub(crate) fn fn_let(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // LET requires an odd number of args >= 3: name1, value1, [name2, value2, ...], body
        if args.len() < 3 || args.len().is_multiple_of(2) {
            return CalcResult::new_args_number_error(cell);
        }

        let pair_count = (args.len() - 1) / 2;
        // Clone the args so we can patch NamedVariableKind ids without touching the stored AST.
        let mut cloned: Vec<Node> = args.to_vec();
        let mut bound_ids: Vec<usize> = Vec::with_capacity(pair_count);

        let mut seen_names = HashSet::new();

        for i in 0..pair_count {
            // Extract the variable name from the declaration node.
            let name = match &cloned[2 * i] {
                Node::NamedVariableKind { name, .. } => name.clone(),
                _ => {
                    // Remove only the ids introduced by this LET frame.
                    for id in bound_ids {
                        self.variable_stack.remove(&id);
                    }
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        format!("LET: argument {} must be a variable name", 2 * i + 1),
                    );
                }
            };

            if !seen_names.insert(name.clone()) {
                return CalcResult::new_error(
                    Error::ERROR,
                    cell,
                    format!("LET: variable name '{}' is already bound", name),
                );
            }

            let raw_id = self.get_next_variable_id();
            let id = raw_id as u32;
            bound_ids.push(raw_id);

            // Patch the variable's id into all subsequent nodes (value expr + body and later pairs).
            // for j in (2 * i + 1)..cloned.len() {
            for item in cloned.iter_mut().skip(2 * i + 1) {
                assign_variable_ids(item, &name, id);
            }

            // Eagerly evaluate the binding value and cache it.
            // CalcResult::Range stores only bounds (no cell data), so range bindings are
            // effectively lazy — values are only read when a consuming function iterates the range.
            // A reference stays a reference, also to a single cell.
            let val = self.evaluate_node_with_reference(&cloned[2 * i + 1], cell);
            self.variable_stack.insert(raw_id, val);
        }

        // Evaluate the body with all bindings in scope.
        let result = self.evaluate_node_in_context(&cloned[args.len() - 1], cell);

        // Remove only the ids introduced by this LET frame.
        for id in bound_ids {
            self.variable_stack.remove(&id);
        }

        result
    }
}
