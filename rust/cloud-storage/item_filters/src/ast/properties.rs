use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::PropertyFilter;
use crate::ast::ExpandErr;
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};

/// The entity type for property lookups in the `entity_properties` table.
///
/// Using a closed enum prevents SQL injection through the `entity_type` field,
/// which is interpolated into dynamic SQL queries.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PropertyEntityType {
    /// Channel entity
    Channel,
    /// Chat entity
    Chat,
    /// Company entity
    Company,
    /// Document entity
    Document,
    /// Project entity
    Project,
    /// Task entity
    Task,
    /// Thread entity
    Thread,
    /// User entity
    User,
}

/// Error returned when parsing an invalid entity type string.
#[derive(Debug, Clone, thiserror::Error)]
#[error("invalid property entity type: {0}")]
pub struct PropertyEntityTypeError(pub String);

impl FromStr for PropertyEntityType {
    type Err = PropertyEntityTypeError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "CHANNEL" => Ok(Self::Channel),
            "CHAT" => Ok(Self::Chat),
            "COMPANY" => Ok(Self::Company),
            "DOCUMENT" => Ok(Self::Document),
            "PROJECT" => Ok(Self::Project),
            "TASK" => Ok(Self::Task),
            "THREAD" => Ok(Self::Thread),
            "USER" => Ok(Self::User),
            _ => Err(PropertyEntityTypeError(s.to_owned())),
        }
    }
}

impl fmt::Display for PropertyEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Channel => write!(f, "CHANNEL"),
            Self::Chat => write!(f, "CHAT"),
            Self::Company => write!(f, "COMPANY"),
            Self::Document => write!(f, "DOCUMENT"),
            Self::Project => write!(f, "PROJECT"),
            Self::Task => write!(f, "TASK"),
            Self::Thread => write!(f, "THREAD"),
            Self::User => write!(f, "USER"),
        }
    }
}

/// A validated entity reference ID that is safe for SQL interpolation.
///
/// Rejects strings containing single quotes, backslashes, or null bytes,
/// which could enable SQL injection when interpolated into dynamic queries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityRefId(String);

/// Error returned when an entity reference ID contains unsafe characters.
#[derive(Debug, Clone, thiserror::Error)]
#[error("entity reference ID contains unsafe characters: {0}")]
pub struct EntityRefIdError(pub String);

impl EntityRefId {
    /// Create a new validated entity reference ID.
    pub fn new(s: String) -> Result<Self, EntityRefIdError> {
        if s.contains('\'') || s.contains('\\') || s.contains('\0') {
            return Err(EntityRefIdError(s));
        }
        Ok(Self(s))
    }
}

impl fmt::Display for EntityRefId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for EntityRefId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for EntityRefId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::new(s).map_err(serde::de::Error::custom)
    }
}

/// Describes how to match against a property value in the entity_properties table.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum PropertyMatchValue {
    /// Match a select option by its UUID. Uses the `?` jsonb operator on `values->'value'`.
    #[serde(rename = "so")]
    SelectOption(Uuid),
    /// Match an entity reference by entity_id. Uses the `@>` jsonb operator on `values->'value'`.
    #[serde(rename = "er")]
    EntityRef(EntityRefId),
}

/// A single property-based filter condition for the AST.
///
/// When converted to SQL, this generates an EXISTS subquery against the
/// `entity_properties` table, checking that the given property has a matching value.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PropertiesLiteral {
    /// The property definition UUID to filter on.
    #[serde(rename = "pd")]
    pub property_definition_id: Uuid,
    /// The entity type for the property lookup (e.g., Task, Document, Project).
    /// When None, matches across all entity types.
    #[serde(default, rename = "et", skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<PropertyEntityType>,
    /// The value to match against.
    #[serde(rename = "v")]
    pub value: PropertyMatchValue,
}

impl ExpandFrame<PropertiesLiteral> for Vec<PropertyFilter> {
    type Err = ExpandErr;
    fn expand_ast(
        filters: Vec<PropertyFilter>,
    ) -> Result<Option<Expr<PropertiesLiteral>>, ExpandErr> {
        let nodes: Vec<Option<Expr<PropertiesLiteral>>> = filters
            .into_iter()
            .map(|pf| {
                let prop_def_id = Uuid::parse_str(&pf.property_definition_id)?;
                let entity_type = pf
                    .entity_type
                    .map(|et| et.parse::<PropertyEntityType>())
                    .transpose()?;

                let option_nodes = pf
                    .option_ids
                    .iter()
                    .map(|s| Uuid::parse_str(s))
                    .try_expand(
                        |r| {
                            r.map(|uuid| PropertiesLiteral {
                                property_definition_id: prop_def_id,
                                entity_type,
                                value: PropertyMatchValue::SelectOption(uuid),
                            })
                        },
                        Expr::or,
                    )?;

                let entity_ref_nodes = pf
                    .entity_ids
                    .iter()
                    .map(|id| EntityRefId::new(id.clone()))
                    .try_expand(
                        |r| {
                            r.map(|id| PropertiesLiteral {
                                property_definition_id: prop_def_id,
                                entity_type,
                                value: PropertyMatchValue::EntityRef(id),
                            })
                        },
                        Expr::or,
                    )?;

                Ok([option_nodes, entity_ref_nodes]
                    .into_iter()
                    .fold_with(Expr::or))
            })
            .collect::<Result<_, ExpandErr>>()?;

        Ok(nodes.into_iter().fold_with(Expr::and))
    }
}
