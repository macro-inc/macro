//! Resolve schema fields, arguments and entity links once per selection/type
//! during a read, instead of once for every entity in a large result list.

use super::*;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) struct Field<'a> {
    pub node: &'a FieldNode,
    pub source: FieldSource<'a>,
}

pub(super) enum FieldSource<'a> {
    Typename,
    MissingArguments,
    Missing(Cow<'a, str>),
    Stored {
        key: Cow<'a, str>,
        type_name: &'static str,
    },
    Entity {
        key: EntityKey<'static>,
        type_name: &'static str,
        storage_key: Cow<'a, str>,
    },
}

type FieldsByConcreteType<'a> = HashMap<String, Arc<[Field<'a>]>>;

/// Read-local plans. Variables and resolver policy must stay fixed, and the
/// borrowed selection trees must remain alive for this entire read.
#[derive(Default)]
pub(crate) struct ReadPlans<'a> {
    // The address identifies an immutable borrowed AST slice, not its content.
    // Length distinguishes subslices; empty slices share equivalent empty plans.
    selections: HashMap<(usize, usize), FieldsByConcreteType<'a>>,
}

impl<'a> ReadPlans<'a> {
    pub(super) fn fields(
        &mut self,
        selections: &'a [Selection],
        concrete: &str,
        variables: &serde_json::Map<String, Json>,
        entity_resolvers: &EntityResolverLookup,
    ) -> Result<Arc<[Field<'a>]>, DenormalizeError> {
        let types = self
            .selections
            .entry((selections.as_ptr() as usize, selections.len()))
            .or_default();
        if let Some(fields) = types.get(concrete) {
            return Ok(Arc::clone(fields));
        }
        let mut nodes = Vec::new();
        collect_fields(selections, concrete, &mut nodes);
        let fields = nodes
            .into_iter()
            .map(|node| compile_field(node, concrete, variables, entity_resolvers))
            .collect::<Result<Arc<[_]>, _>>()?;
        types.insert(concrete.to_owned(), Arc::clone(&fields));
        Ok(fields)
    }
}

fn compile_field<'a>(
    node: &'a FieldNode,
    concrete: &str,
    variables: &serde_json::Map<String, Json>,
    entity_resolvers: &EntityResolverLookup,
) -> Result<Field<'a>, DenormalizeError> {
    if node.name == "__typename" {
        return Ok(Field {
            node,
            source: FieldSource::Typename,
        });
    }
    let metadata =
        meta::field_meta(concrete, &node.name).ok_or_else(|| DenormalizeError::UnknownField {
            type_name: concrete.to_owned(),
            field: node.name.clone(),
        })?;
    let resolver = entity_resolvers.get(concrete, &node.name);
    let arguments = match resolve_args(node, variables) {
        Ok(arguments) => arguments,
        Err(_) if resolver.is_some() => {
            return Ok(Field {
                node,
                source: FieldSource::MissingArguments,
            });
        }
        Err(error) => return Err(error.into()),
    };
    let storage_key = match resolved_args_key(node, &arguments) {
        Some(args) => Cow::Owned(field_key(&node.name, Some(&args))),
        None => Cow::Borrowed(node.name.as_str()),
    };
    let source = match resolver {
        Some(resolver) => match resolver.entity_key(&arguments) {
            Some(key) => FieldSource::Entity {
                key,
                storage_key,
                type_name: meta::type_meta(&resolver.target_type)
                    .expect("compiled resolver target exists")
                    .name,
            },
            None => FieldSource::Missing(storage_key),
        },
        None => FieldSource::Stored {
            key: storage_key,
            type_name: metadata.ty.name,
        },
    };
    Ok(Field { node, source })
}
