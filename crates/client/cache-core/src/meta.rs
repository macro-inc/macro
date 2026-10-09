//! Immutable runtime schema metadata, supplied by the frontend bundle.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};

/// Composite output type classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TypeKind {
    /// A concrete output object.
    Object,
    /// A union of concrete output objects.
    Union,
    /// An interface implemented by concrete objects.
    Interface,
}
/// Storage interpretation of a field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FieldKind {
    /// A selectable object, interface, or union.
    Composite,
    /// A built-in scalar or enum.
    Leaf,
    /// A custom scalar stored as opaque JSON.
    OpaqueScalar,
}
/// Borrowed field shape used by cache walks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldType<'a> {
    /// GraphQL name.
    pub name: &'a str,
    /// Output or storage classification.
    pub kind: FieldKind,
    /// Whether the outer value may be null.
    pub nullable: bool,
    /// Whether the field contains a list.
    pub list: bool,
    /// Whether list elements may be null.
    pub item_nullable: bool,
}
/// Owned field shape in the metadata artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedFieldType {
    /// GraphQL name.
    pub name: String,
    /// Output or storage classification.
    pub kind: FieldKind,
    /// Whether the outer value may be null.
    pub nullable: bool,
    /// Whether the field contains a list.
    pub list: bool,
    /// Whether list elements may be null.
    pub item_nullable: bool,
}
/// Owned field definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnedFieldMeta {
    /// GraphQL name.
    pub name: String,
    /// Declared return shape.
    pub ty: OwnedFieldType,
}
/// Borrowed field definition.
#[derive(Debug, Clone, Copy)]
pub struct FieldMeta<'a> {
    /// GraphQL name.
    pub name: &'a str,
    /// Declared return shape.
    pub ty: FieldType<'a>,
}
/// Output type and its normalization policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeMeta {
    /// GraphQL name.
    pub name: String,
    /// Output or storage classification.
    pub kind: TypeKind,
    /// Entity identity fields; absent for embedded objects.
    pub key_fields: Option<Vec<String>>,
    /// Declared fields on this output type.
    pub fields: Vec<OwnedFieldMeta>,
    /// Concrete union members or interface implementors.
    pub possible_types: Vec<String>,
}
/// Versioned internal persistence format for merged schema lookup tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaArtifact {
    /// Persistence format understood by the engine.
    pub format_version: u32,
    /// Persisted record semantics required by this schema.
    pub compatibility_epoch: u32,
    /// Query operation root.
    pub query_root: String,
    /// Optional mutation operation root.
    pub mutation_root: Option<String>,
    /// Optional subscription operation root.
    pub subscription_root: Option<String>,
    /// Composite output definitions.
    pub types: Vec<TypeMeta>,
}
/// Validated immutable snapshot owned by an engine.
#[derive(Debug)]
pub struct Schema {
    artifact: SchemaArtifact,
    hash: String,
}
/// Invalid or unsupported schema metadata. Loading never modifies storage.
#[derive(Debug, thiserror::Error)]
#[error("invalid cache schema: {0}")]
pub struct SchemaError(String);
impl Schema {
    /// Decode persisted metadata before opening its cache.
    pub fn from_json(json: &str) -> Result<Arc<Self>, SchemaError> {
        let artifact: SchemaArtifact =
            serde_json::from_str(json).map_err(|e| SchemaError(e.to_string()))?;
        Self::from_artifact(artifact)
    }
    /// Validate metadata and compute its canonical identity.
    pub fn from_artifact(mut artifact: SchemaArtifact) -> Result<Arc<Self>, SchemaError> {
        if artifact.format_version != 1
            || artifact.compatibility_epoch != crate::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH
        {
            return Err(SchemaError(
                "unsupported format or compatibility epoch; a native update is required".into(),
            ));
        }
        artifact.types.sort_by(|a, b| a.name.cmp(&b.name));
        for ty in &mut artifact.types {
            ty.fields.sort_by(|a, b| a.name.cmp(&b.name));
            ty.possible_types.sort();
        }
        let schema = Self {
            artifact,
            hash: String::new(),
        };
        schema.validate()?;
        let bytes = serde_json::to_vec(&schema.artifact).map_err(|e| SchemaError(e.to_string()))?;
        let hash = format!("{:x}", Sha256::digest(bytes));
        Ok(Arc::new(Self { hash, ..schema }))
    }
    /// Combines compatible bundle versions, retaining definitions needed by queued work.
    /// Shape and identity changes require an explicit engine/storage migration.
    pub fn merge(&self, incoming: &Schema) -> Result<Arc<Self>, SchemaError> {
        if self.artifact.query_root != incoming.artifact.query_root
            || self.artifact.mutation_root != incoming.artifact.mutation_root
            || self.artifact.subscription_root != incoming.artifact.subscription_root
        {
            return Err(SchemaError(
                "operation roots changed; native migration required".into(),
            ));
        }
        let mut artifact = self.artifact.clone();
        for ty in &incoming.artifact.types {
            let Some(existing) = artifact.types.iter_mut().find(|t| t.name == ty.name) else {
                artifact.types.push(ty.clone());
                continue;
            };
            if existing.kind != ty.kind || existing.key_fields != ty.key_fields {
                return Err(SchemaError(format!(
                    "type {} changed identity or kind",
                    ty.name
                )));
            }
            for field in &ty.fields {
                if let Some(previous) = existing.fields.iter().find(|f| f.name == field.name) {
                    if previous != field {
                        return Err(SchemaError(format!(
                            "field {}.{} changed shape",
                            ty.name, field.name
                        )));
                    }
                } else {
                    existing.fields.push(field.clone());
                }
            }
            for name in &ty.possible_types {
                if !existing.possible_types.contains(name) {
                    existing.possible_types.push(name.clone());
                }
            }
        }
        Self::from_artifact(artifact)
    }
    fn validate(&self) -> Result<(), SchemaError> {
        let fail = |message: &str| Err(SchemaError(message.into()));
        for pair in self.artifact.types.windows(2) {
            if pair[0].name == pair[1].name {
                return fail("duplicate type");
            }
        }
        for root in std::iter::once(self.query_root())
            .chain(self.mutation_root())
            .chain(self.subscription_root())
        {
            let Some(ty) = self.type_meta(root) else {
                return fail("missing operation root");
            };
            if ty.kind != TypeKind::Object
                || ty.key_fields.is_some()
                || ty.fields.iter().any(|f| f.name == "id")
            {
                return fail("invalid operation root");
            }
        }
        for ty in &self.artifact.types {
            if ty.name.is_empty() {
                return fail("empty type name");
            }
            if ty.fields.windows(2).any(|p| p[0].name == p[1].name) {
                return fail("duplicate field");
            }
            if ty.possible_types.windows(2).any(|p| p[0] == p[1]) {
                return fail("duplicate possible type");
            }
            let id = ty.fields.iter().find(|f| f.name == "id");
            if let Some(id) = id
                && (id.ty.name != "ID"
                    || id.ty.nullable
                    || id.ty.list
                    || id.ty.kind != FieldKind::Leaf)
            {
                return fail("entity id must be ID!");
            }
            if ty
                .key_fields
                .as_ref()
                .map(|keys| keys.iter().map(String::as_str).collect::<Vec<_>>())
                != id.map(|_| vec!["id"])
            {
                return fail("invalid entity key policy");
            }
            if ty.kind == TypeKind::Union && !ty.fields.is_empty() {
                return fail("union has fields");
            }
            if ty.kind == TypeKind::Object && !ty.possible_types.is_empty() {
                return fail("object has possible types");
            }
            for name in &ty.possible_types {
                if !self
                    .type_meta(name)
                    .is_some_and(|t| t.kind == TypeKind::Object)
                {
                    return fail("invalid possible type");
                }
            }
            for field in &ty.fields {
                if field.name.is_empty() || field.ty.name.is_empty() {
                    return fail("empty field or return type");
                }
                if (field.ty.kind == FieldKind::Composite)
                    != self.type_meta(&field.ty.name).is_some()
                {
                    return fail("invalid composite field reference");
                }
            }
        }
        Ok(())
    }
    /// Identity used to reject mixed bundle schemas in a shared native engine.
    pub fn hash(&self) -> &str {
        &self.hash
    }
    /// Canonical metadata for persistence and diagnostics.
    pub fn artifact(&self) -> &SchemaArtifact {
        &self.artifact
    }
    /// Query root name.
    pub fn query_root(&self) -> &str {
        &self.artifact.query_root
    }
    /// Optional mutation root name.
    pub fn mutation_root(&self) -> Option<&str> {
        self.artifact.mutation_root.as_deref()
    }
    /// Optional subscription root name.
    pub fn subscription_root(&self) -> Option<&str> {
        self.artifact.subscription_root.as_deref()
    }
    /// Looks up a composite type.
    pub fn type_meta(&self, name: &str) -> Option<&TypeMeta> {
        self.artifact
            .types
            .binary_search_by(|t| t.name.as_str().cmp(name))
            .ok()
            .map(|i| &self.artifact.types[i])
    }
    /// Borrows a field shape without allocating.
    pub fn field_meta(&self, type_name: &str, field: &str) -> Option<FieldMeta<'_>> {
        let fields = &self.type_meta(type_name)?.fields;
        let f = &fields[fields
            .binary_search_by(|f| f.name.as_str().cmp(field))
            .ok()?];
        Some(FieldMeta {
            name: &f.name,
            ty: FieldType {
                name: &f.ty.name,
                kind: f.ty.kind,
                nullable: f.ty.nullable,
                list: f.ty.list,
                item_nullable: f.ty.item_nullable,
            },
        })
    }
    /// Tests concrete membership in a fragment condition.
    pub fn type_matches(&self, concrete: &str, condition: &str) -> bool {
        concrete == condition
            || self
                .type_meta(condition)
                .is_some_and(|t| t.possible_types.iter().any(|name| name == concrete))
    }
}
/// SDL embedded for legacy callers and tests; production hosts supply bundle SDL.
pub const BUNDLED_SCHEMA_SDL: &str = include_str!("../../../../static_assets/schema.graphql");
/// Fingerprint of the SDL embedded in this build, for diagnostics.
pub const SCHEMA_HASH: &str = env!("CACHE_BUNDLED_SCHEMA_HASH");
static BUNDLED_SCHEMA: LazyLock<Arc<Schema>> =
    LazyLock::new(|| Schema::from_sdl(BUNDLED_SCHEMA_SDL).expect("valid bundled schema"));
mod sdl;
/// Embedded fixture/default for Rust callers. Production hosts supply bundle SDL.
pub fn bundled_schema_ref() -> &'static Schema {
    &BUNDLED_SCHEMA
}
/// Embedded schema for legacy Rust callers and tests.
pub fn bundled_schema() -> Arc<Schema> {
    Arc::clone(&BUNDLED_SCHEMA)
}
/// Legacy lookup against the embedded schema.
pub fn type_meta(name: &str) -> Option<&'static TypeMeta> {
    BUNDLED_SCHEMA.type_meta(name)
}
/// Legacy field lookup against the embedded schema.
pub fn field_meta(type_name: &str, field: &str) -> Option<FieldMeta<'static>> {
    BUNDLED_SCHEMA.field_meta(type_name, field)
}
/// Legacy fragment matching against the embedded schema.
pub fn type_matches(concrete: &str, condition: &str) -> bool {
    BUNDLED_SCHEMA.type_matches(concrete, condition)
}
#[cfg(test)]
mod test;
