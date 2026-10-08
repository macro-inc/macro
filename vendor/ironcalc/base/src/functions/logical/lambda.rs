use crate::{
    calc_result::CalcResult,
    expressions::{
        parser::{NamedVariable, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    model::Model,
};

use super::r#let::assign_variable_ids;

impl<'a> Model<'a> {
    /// Evaluates the body of a named lambda with the given call-site argument nodes.
    /// Optional parameters not covered by call_args receive EmptyArg.
    pub(crate) fn call_lambda(
        &mut self,
        lambda_result: CalcResult,
        call_args: &[Node],
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let (parameters, body) = match lambda_result {
            CalcResult::Lambda(id) => match self.lambdas.get(&id) {
                Some(l) => l.clone(),
                None => {
                    return CalcResult::new_error(
                        Error::NAME,
                        cell,
                        "Lambda not found in store".to_string(),
                    )
                }
            },
            other if other.is_error() => return other,
            _ => return CalcResult::new_error(Error::VALUE, cell, "Expected a LAMBDA".to_string()),
        };

        if let Err(e) = check_arg_count(&parameters, call_args.len(), cell) {
            return e;
        }

        let mut patched_body = body;
        let mut bound_ids: Vec<usize> = Vec::with_capacity(parameters.len());

        for param in &parameters {
            let raw_id = self.get_next_variable_id();
            assign_variable_ids(&mut patched_body, &param.name, raw_id as u32);
            bound_ids.push(raw_id);
        }

        for (i, raw_id) in bound_ids.iter().enumerate() {
            // A reference is passed as a reference, also to a single cell:
            // the parameter can then go where a reference is wanted, as in
            // LAMBDA(x, MAX(x))(A1), where the text in A1 does not count
            let val = if i < call_args.len() {
                self.evaluate_node_with_reference(&call_args[i], cell)
            } else {
                CalcResult::EmptyArg
            };
            self.variable_stack.insert(*raw_id, val);
        }

        let result = self.evaluate_node_in_context(&patched_body, cell);

        for raw_id in bound_ids {
            self.variable_stack.remove(&raw_id);
        }

        result
    }

    /// Like `call_lambda` but accepts already-evaluated `CalcResult` values instead of `Node`s.
    /// Optional parameters not covered by `values` receive EmptyArg.
    pub(crate) fn call_lambda_with_values(
        &mut self,
        lambda_result: CalcResult,
        values: Vec<CalcResult>,
        cell: CellReferenceIndex,
    ) -> CalcResult {
        let (parameters, body) = match lambda_result {
            CalcResult::Lambda(id) => match self.lambdas.get(&id) {
                Some(l) => l.clone(),
                None => {
                    return CalcResult::new_error(
                        Error::NAME,
                        cell,
                        "Lambda not found in store".to_string(),
                    )
                }
            },
            other if other.is_error() => return other,
            _ => return CalcResult::new_error(Error::VALUE, cell, "Expected a LAMBDA".to_string()),
        };

        if let Err(e) = check_arg_count(&parameters, values.len(), cell) {
            return e;
        }

        let mut patched_body = body;
        let mut bound_ids: Vec<usize> = Vec::with_capacity(parameters.len());

        for param in &parameters {
            let raw_id = self.get_next_variable_id();
            assign_variable_ids(&mut patched_body, &param.name, raw_id as u32);
            bound_ids.push(raw_id);
        }

        for (i, raw_id) in bound_ids.iter().enumerate() {
            let val = if i < values.len() {
                values[i].clone()
            } else {
                CalcResult::EmptyArg
            };
            self.variable_stack.insert(*raw_id, val);
        }

        let result = self.evaluate_node_in_context(&patched_body, cell);

        for raw_id in bound_ids {
            self.variable_stack.remove(&raw_id);
        }

        result
    }

    pub(crate) fn fn_lambda(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        // Reached when LAMBDA is stored as FunctionKind::Lambda (e.g. imported from xlsx).
        if args.is_empty() {
            return CalcResult::new_args_number_error(cell);
        }
        let last = args.len() - 1;
        let body = args[last].clone();
        let parameters: Vec<NamedVariable> = args[..last]
            .iter()
            .filter_map(|n| {
                if let Node::NamedVariableKind { name, id } = n {
                    let (clean, is_optional) = if let Some(s) = name.strip_prefix("_xlop.") {
                        (s.to_string(), true)
                    } else if let Some(s) = name.strip_prefix("_xlpm.") {
                        (s.to_string(), false)
                    } else {
                        (name.clone(), false)
                    };
                    Some(NamedVariable {
                        name: clean,
                        id: *id,
                        is_optional,
                    })
                } else {
                    None
                }
            })
            .collect();

        let id = self.get_next_lambda_id();
        self.lambdas.insert(id, (parameters, body));
        CalcResult::Lambda(id)
    }
}

fn check_arg_count(
    parameters: &[NamedVariable],
    provided: usize,
    cell: CellReferenceIndex,
) -> Result<(), CalcResult> {
    let required = parameters.iter().filter(|p| !p.is_optional).count();
    let total = parameters.len();
    if provided < required || provided > total {
        let msg = if required == total {
            format!("LAMBDA expected {} argument(s), got {}", total, provided)
        } else {
            format!(
                "LAMBDA expected between {} and {} argument(s), got {}",
                required, total, provided
            )
        };
        Err(CalcResult::new_error(Error::VALUE, cell, msg))
    } else {
        Ok(())
    }
}
