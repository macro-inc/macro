//! Schema metadata: static tables generated at build time from
//! `rust/cloud-storage/schema.graphql` + `key_config.toml` (see `build.rs`).
//!
//! The cache never parses SDL at runtime — everything type-related is
//! resolved through these tables.

/// Kind of a composite (selectable) type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeKind {
    Object,
    Union,
    Interface,
}

/// What a field's named type resolves to, decided at codegen time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    /// Object / union / interface — value is a link (ref) or embedded object.
    Composite,
    /// Built-in scalar or enum — stored as a plain leaf value.
    Leaf,
    /// Custom scalar (e.g. `JSON`) — stored as an opaque JSON blob.
    OpaqueScalar,
}

/// Flattened GraphQL wrapping type. Nested lists are rejected at codegen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldType {
    /// The named (inner) type.
    pub name: &'static str,
    pub kind: FieldKind,
    /// Nullability of the outermost wrapper.
    pub nullable: bool,
    pub list: bool,
    /// Only meaningful when `list` is true.
    pub item_nullable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldMeta {
    pub name: &'static str,
    pub ty: FieldType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypeMeta {
    pub name: &'static str,
    pub kind: TypeKind,
    /// `Some(fields)` when the type is a normalized entity; `None` when it is
    /// embedded inline in its parent record. Policy from `key_config.toml`.
    pub key_fields: Option<&'static [&'static str]>,
    /// Field definitions (objects/interfaces only; empty for unions).
    pub fields: &'static [FieldMeta],
    /// Union members / interface implementors (empty for plain objects).
    pub possible_types: &'static [&'static str],
}

include!(concat!(env!("OUT_DIR"), "/schema_meta.rs"));

/// Looks up a composite type by name. `TYPES` is sorted by name at codegen.
pub fn type_meta(name: &str) -> Option<&'static TypeMeta> {
    TYPES
        .binary_search_by(|t| t.name.cmp(name))
        .ok()
        .map(|i| &TYPES[i])
}

/// Looks up a field on a composite type.
pub fn field_meta(type_name: &str, field: &str) -> Option<&'static FieldMeta> {
    let t = type_meta(type_name)?;
    t.fields.iter().find(|f| f.name == field)
}

/// True when an object of concrete type `concrete` matches a fragment type
/// condition `condition` (exact match, union membership, or interface
/// implementation).
pub fn type_matches(concrete: &str, condition: &str) -> bool {
    if concrete == condition {
        return true;
    }
    match type_meta(condition) {
        Some(meta) => meta.possible_types.contains(&concrete),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_root_is_present() {
        let root = type_meta(QUERY_ROOT_TYPE).expect("query root type");
        assert_eq!(root.kind, TypeKind::Object);
        assert!(root.key_fields.is_none());
        assert!(root.fields.iter().any(|f| f.name == "user"));

        // The viewer object is keyed and doubles as the identity witness.
        let user = type_meta("GraphqlUser").expect("user type");
        assert_eq!(user.key_fields, Some(&["id"][..]));
        assert!(user.fields.iter().any(|f| f.name == "soup"));
        assert_eq!(IDENTITY_WITNESS, Some("GraphqlUser"));
    }

    #[test]
    fn union_possible_types() {
        let entity = type_meta("GraphqlSoupEntity").expect("entity union");
        assert_eq!(entity.kind, TypeKind::Union);
        assert!(entity.possible_types.contains(&"GraphqlSoupDocument"));
        assert!(entity.possible_types.contains(&"GraphqlSoupForeignEntity"));
        assert_eq!(entity.possible_types.len(), 9);
        assert!(type_matches("GraphqlSoupDocument", "GraphqlSoupEntity"));
        assert!(!type_matches("GraphqlSoupItem", "GraphqlSoupEntity"));
    }

    #[test]
    fn key_config_applied() {
        assert_eq!(
            type_meta("GraphqlSoupDocument").unwrap().key_fields,
            Some(&["id"][..])
        );
        assert_eq!(
            type_meta("GraphqlSoupChannelMessage").unwrap().key_fields,
            Some(&["messageId"][..])
        );
        // Property values are per-entity even though properties carry the
        // definition id — must stay embedded.
        assert_eq!(type_meta("GraphqlSoupProperty").unwrap().key_fields, None);
        assert_eq!(type_meta("SoupPage").unwrap().key_fields, None);
    }

    #[test]
    fn field_shapes() {
        // properties: [GraphqlSoupProperty!]!
        let f = field_meta("GraphqlSoupDocument", "properties").unwrap();
        assert_eq!(f.ty.name, "GraphqlSoupProperty");
        assert_eq!(f.ty.kind, FieldKind::Composite);
        assert!(!f.ty.nullable && f.ty.list && !f.ty.item_nullable);

        // viewedAt: String (nullable leaf)
        let f = field_meta("GraphqlSoupDocument", "viewedAt").unwrap();
        assert_eq!(f.ty.kind, FieldKind::Leaf);
        assert!(f.ty.nullable && !f.ty.list);

        // metadata: JSON! (opaque scalar)
        let f = field_meta("GraphqlSoupForeignEntity", "metadata").unwrap();
        assert_eq!(f.ty.kind, FieldKind::OpaqueScalar);
        assert!(!f.ty.nullable);

        // entity: GraphqlSoupEntity! (composite link to a union)
        let f = field_meta("GraphqlSoupItem", "entity").unwrap();
        assert_eq!(f.ty.kind, FieldKind::Composite);
        assert_eq!(f.ty.name, "GraphqlSoupEntity");
    }

    #[test]
    fn schema_hash_present() {
        assert_eq!(SCHEMA_HASH.len(), 64);
    }
}
