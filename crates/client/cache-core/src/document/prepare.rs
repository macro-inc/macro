//! Apply executable directives and variable defaults before either cache walk.
use super::*;

impl Operation {
    pub(crate) fn prepare(
        &self,
        variables: &serde_json::Map<String, Json>,
    ) -> Result<Self, DocumentError> {
        let mut resolved = self.variable_defaults.clone();
        resolved.extend(variables.clone());
        Ok(Self {
            name: self.name.clone(),
            kind: self.kind,
            variable_defaults: serde_json::Map::new(),
            selection_set: prepare_selections(&self.selection_set, &resolved)?,
        })
    }
}

pub(super) fn conditions(
    directives: Option<cst::Directives>,
) -> Result<Vec<(String, ArgValue)>, DocumentError> {
    let mut conditions = Vec::new();
    if let Some(directives) = directives {
        for directive in directives.directives() {
            let name = directive
                .name()
                .ok_or(DocumentError::Malformed("directive without name"))?
                .text()
                .to_string();
            match name.as_str() {
                "cacheOnly" => {}
                "include" | "skip" => {
                    let value = directive
                        .arguments()
                        .and_then(|args| {
                            args.arguments()
                                .find(|arg| arg.name().is_some_and(|name| name.text() == "if"))
                        })
                        .and_then(|arg| arg.value())
                        .ok_or_else(|| DocumentError::InvalidCondition(name.clone()))?;
                    conditions.push((name, convert_value(value)?));
                }
                _ => return Err(DocumentError::UnsupportedDirective(name)),
            }
        }
    }
    Ok(conditions)
}

pub(crate) fn prepare_selections(
    selections: &[Selection],
    variables: &serde_json::Map<String, Json>,
) -> Result<Vec<Selection>, DocumentError> {
    let mut out = Vec::new();
    for selection in selections {
        let conditions = match selection {
            Selection::Field(field) => &field.conditions,
            Selection::Fragment { conditions, .. } => conditions,
        };
        let mut include = true;
        for (name, condition) in conditions {
            let value = resolve_arg(condition, variables)
                .ok()
                .and_then(|value| value.as_bool())
                .ok_or_else(|| DocumentError::InvalidCondition(name.clone()))?;
            include &= if name == "skip" { !value } else { value };
        }
        if !include {
            continue;
        }
        out.push(match selection {
            Selection::Field(field) => {
                let mut field = field.clone();
                field.conditions.clear();
                for (_, value) in &mut field.arguments {
                    // Preserve the established missing-variable behavior, but
                    // freeze provided/defaulted arguments in this read plan.
                    if let Ok(resolved) = resolve_arg(value, variables) {
                        *value = ArgValue::Const(resolved);
                    }
                }
                field.selection_set = prepare_selections(&field.selection_set, variables)?;
                Selection::Field(field)
            }
            Selection::Fragment {
                type_condition,
                selection_set,
                ..
            } => Selection::Fragment {
                type_condition: type_condition.clone(),
                conditions: Vec::new(),
                selection_set: prepare_selections(selection_set, variables)?,
            },
        });
    }
    Ok(out)
}
