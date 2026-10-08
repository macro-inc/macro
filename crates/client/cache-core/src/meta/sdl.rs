//! Parse bundle SDL into the cache's owned lookup tables.
//! Objects with `id: ID!` are entities; objects without `id` are embedded.
//! The shared metadata validator rejects other id shapes and keyed operation roots.
use super::*;
use apollo_compiler::ast::{FieldDefinition, Type};
use apollo_compiler::schema::{Component, ExtendedType};
use apollo_compiler::{Name, Schema as GraphqlSchema};

impl Schema {
    /// Parse and validate GraphQL SDL before installing any schema or opening storage.
    pub fn from_sdl(sdl: &str) -> Result<Arc<Self>, SchemaError> {
        let schema = GraphqlSchema::parse_and_validate(sdl, "schema.graphql")
            .map_err(|error| SchemaError(error.to_string()))?;
        let query_root = schema
            .schema_definition
            .query
            .as_ref()
            .ok_or_else(|| SchemaError("missing query root".into()))?
            .name
            .to_string();
        let mut types = Vec::new();
        for (name, ty) in &schema.types {
            if name.starts_with("__") {
                continue;
            }
            let (kind, fields, possible_types) = match ty {
                ExtendedType::Object(object) => (
                    TypeKind::Object,
                    fields(&schema, object.fields.iter())?,
                    Vec::new(),
                ),
                ExtendedType::Interface(interface) => (
                    TypeKind::Interface,
                    fields(&schema, interface.fields.iter())?,
                    schema
                        .types
                        .iter()
                        .filter_map(|(object_name, ty)| match ty {
                            ExtendedType::Object(object)
                                if object.implements_interfaces.contains(name) =>
                            {
                                Some(object_name.to_string())
                            }
                            _ => None,
                        })
                        .collect(),
                ),
                ExtendedType::Union(union) => (
                    TypeKind::Union,
                    Vec::new(),
                    union
                        .members
                        .iter()
                        .map(|member| member.name.to_string())
                        .collect(),
                ),
                _ => continue,
            };
            let key_fields = fields
                .iter()
                .any(|field| field.name == "id")
                .then(|| vec!["id".into()]);
            types.push(TypeMeta {
                name: name.to_string(),
                kind,
                key_fields,
                fields,
                possible_types,
            });
        }
        Self::from_artifact(SchemaArtifact {
            format_version: 1,
            compatibility_epoch: crate::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH,
            query_root,
            mutation_root: schema
                .schema_definition
                .mutation
                .as_ref()
                .map(|root| root.name.to_string()),
            subscription_root: schema
                .schema_definition
                .subscription
                .as_ref()
                .map(|root| root.name.to_string()),
            types,
        })
    }
}

fn fields<'a>(
    schema: &GraphqlSchema,
    definitions: impl Iterator<Item = (&'a Name, &'a Component<FieldDefinition>)>,
) -> Result<Vec<OwnedFieldMeta>, SchemaError> {
    definitions
        .map(|(name, definition)| {
            let (inner, nullable, list) = match &definition.ty {
                Type::Named(_) => (&definition.ty, true, false),
                Type::NonNullNamed(_) => (&definition.ty, false, false),
                Type::List(inner) => (inner.as_ref(), true, true),
                Type::NonNullList(inner) => (inner.as_ref(), false, true),
            };
            let (named, item_nullable) = match inner {
                Type::Named(named) => (named, list),
                Type::NonNullNamed(named) => (named, false),
                _ => {
                    return Err(SchemaError(format!(
                        "nested lists are not supported: {name}"
                    )));
                }
            };
            let kind = match schema.types.get(named) {
                Some(
                    ExtendedType::Object(_) | ExtendedType::Interface(_) | ExtendedType::Union(_),
                ) => FieldKind::Composite,
                Some(ExtendedType::Enum(_)) => FieldKind::Leaf,
                Some(ExtendedType::Scalar(_)) => {
                    if matches!(
                        named.as_str(),
                        "Int" | "Float" | "String" | "Boolean" | "ID"
                    ) {
                        FieldKind::Leaf
                    } else {
                        FieldKind::OpaqueScalar
                    }
                }
                _ => return Err(SchemaError(format!("invalid output type: {named}"))),
            };
            Ok(OwnedFieldMeta {
                name: name.to_string(),
                ty: OwnedFieldType {
                    name: named.to_string(),
                    kind,
                    nullable,
                    list,
                    item_nullable,
                },
            })
        })
        .collect()
}
