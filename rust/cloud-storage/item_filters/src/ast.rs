//! This module defines stricter typing for the filters found in lib.
//! This is used to construct a strictly typed ast for the input filters, allowing consumers to have a logical represenation of the required operations

use crate::{
    CallFilters, ChannelFilters, ChatFilters, DocumentFilters, EmailFilters, EntityFilters,
    ForeignEntityFilters, ProjectFilters, PropertyFilter,
    ast::{
        call::CallLiteral,
        channel::{ChannelLiteral, ChannelTypeFilter},
        chat::{ChatLiteral, ChatRole},
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
        project::ProjectLiteral,
        properties::PropertiesLiteral,
    },
};
use document::DocumentLiteral;
use filter_ast::{ExpandFrame, Expr};
use non_empty::IsEmpty;
use serde::{Deserialize, Serialize};
use std::{marker::PhantomData, sync::Arc};
use thiserror::Error;

/// contains the ast literal value for calls
pub mod call;
/// contains the ast literal value for channels
pub mod channel;
/// contains the ast literal value for chat
pub mod chat;
/// contains the date comparison literal type
pub mod date;
/// contains the ast literal value for documents
pub mod document;
/// contains the ast literal value for emails
pub mod email;
/// contains the ast literal value for foreign entities
pub mod foreign_entity;
/// contains the ast literal value for projects
pub mod project;
/// contains the ast literal value for property-based filtering
pub mod properties;

#[cfg(test)]
mod tests;

/// encountered an unknown file type
#[derive(Debug, Error)]
#[error("Found unknown value {0} when attempting to parse {t}", t = std::any::type_name::<T>())]
pub struct UnknownValue<T>(String, PhantomData<T>);

trait ParseFromStr: Sized {
    fn parse_from_str<T: AsRef<str>>(s: T) -> Result<Self, UnknownValue<Self>>;
}

/// the types of errors that can occur when expanding [DocumentFilters] into an ast
#[derive(Debug, Error)]
pub enum ExpandErr {
    /// unknown file type
    #[error(transparent)]
    FileTypeErr(#[from] model_file_type::ValueError<model_file_type::FileType>),
    /// unknown chat type
    #[error(transparent)]
    ChatRoleErr(#[from] UnknownValue<ChatRole>),
    /// unknown channel type
    #[error(transparent)]
    ChannelTypeErr(#[from] UnknownValue<ChannelTypeFilter>),
    /// invalid uuid
    #[error("Invalid uuid string: {0}")]
    Uuid(#[from] uuid::Error),
    /// invalid macro user id
    #[error(transparent)]
    MacroIdErr(#[from] macro_user_id::error::ParseErr),
    /// unknown document sub type
    #[error(transparent)]
    DocumentSubTypeErr(#[from] strum::ParseError),
    /// invalid property entity type
    #[error(transparent)]
    PropertyEntityType(#[from] properties::PropertyEntityTypeError),
    /// invalid entity reference id
    #[error(transparent)]
    EntityRefId(#[from] properties::EntityRefIdError),
    /// invalid API AST expansion
    #[error("invalid API AST expansion: {0}")]
    ApiAst(String),
    /// crm_domains and crm_addresses cannot both be populated in the same request
    #[error("crm_domains and crm_addresses cannot both be populated in the same request")]
    CrmDomainsAndAddressesMutuallyExclusive,
    /// a value in crm_domains does not look like a bare domain
    #[error("invalid crm_domains value (must be a bare domain like 'acme.com'): {0}")]
    InvalidCrmDomain(String),
    /// a value in crm_addresses does not parse as a fully-qualified email address
    #[error("invalid crm_addresses value (must be a fully-qualified email): {0}")]
    InvalidCrmAddress(String),
}

/// CRM-scoped query authorization tag produced by [`EmailFilters`] expansion.
///
/// Carried alongside the email AST through [`EntityFilterAst`] and into the
/// email service, where it drives:
///   1. authorization (each domain/address must pass a CRM pre-check), and
///   2. candidate-set widening (the dynamic query expands from the caller's
///      single `link_id` to every team member's `link_id`).
///
/// Mutually exclusive: at most one variant carries values, and the inner
/// `Vec<String>` is guaranteed non-empty. The custom [`Deserialize`] impl
/// below rejects forged payloads with empty vectors, since an empty
/// scope tag would desynchronize downstream auth/widening behavior from
/// AST intent.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum CrmScope {
    /// caller is asking for team-visible threads involving any of these domains
    Domains(Vec<String>),
    /// caller is asking for team-visible threads involving any of these addresses
    Addresses(Vec<String>),
}

impl<'de> Deserialize<'de> for CrmScope {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Mirror the auto-derived shape, then validate non-empty.
        #[derive(Deserialize)]
        enum Raw {
            Domains(Vec<String>),
            Addresses(Vec<String>),
        }
        let raw = Raw::deserialize(d)?;
        match raw {
            Raw::Domains(v) if v.is_empty() => Err(serde::de::Error::custom(
                "CrmScope::Domains requires at least one domain",
            )),
            Raw::Addresses(v) if v.is_empty() => Err(serde::de::Error::custom(
                "CrmScope::Addresses requires at least one address",
            )),
            Raw::Domains(v) => Ok(CrmScope::Domains(v)),
            Raw::Addresses(v) => Ok(CrmScope::Addresses(v)),
        }
    }
}

/// type alias for a maybe empty, cheaply cloneable ast literal tree
pub type LiteralTree<T> = Option<Arc<Expr<T>>>;

/// Email-entity filter bundle: the literal AST tree plus any CRM scope
/// tag that came from typed-filter expansion.
///
/// Bundled (rather than two parallel fields on [`EntityFilterAst`])
/// because the tag is logically a property of the email filter — it
/// directs which mailboxes to search and which authorization checks to
/// apply, both governed by the same email-entity machinery downstream.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailFilterAst {
    /// The literal AST tree.
    #[serde(default, rename = "t", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub tree: LiteralTree<EmailLiteral>,
    /// CRM-scope tag set by [`crate::EmailFilters`] expansion when the
    /// request carries `crm_domains` or `crm_addresses`. Drives
    /// authorization and candidate-set widening in the email service.
    #[serde(default, rename = "cs", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub crm_scope: Option<CrmScope>,
}

impl IsEmpty for EmailFilterAst {
    fn is_empty(&self) -> bool {
        self.tree.is_none() && self.crm_scope.is_none()
    }
}

/// Describes a bundle of filters that should be applied across different entity types
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EntityFilterAst {
    /// the filters that should be applied to the document entity
    #[serde(default, rename = "df")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub document_filter: LiteralTree<DocumentLiteral>,
    /// the filters that should be applied to the project entity
    #[serde(default, rename = "pf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub project_filter: LiteralTree<ProjectLiteral>,
    /// the filters that should be applied to the chat entity
    #[serde(default, rename = "cf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub chat_filter: LiteralTree<ChatLiteral>,
    /// the filters that should be applied to the email entity — bundles
    /// the literal AST tree and any CRM scope tag (see [`EmailFilterAst`])
    #[serde(default, rename = "ef")]
    pub email_filter: EmailFilterAst,
    /// the filters that should be applied to the channel entity
    #[serde(default, rename = "chanf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub channel_filter: LiteralTree<ChannelLiteral>,
    /// the filters that should be applied to the call entity
    #[serde(default, rename = "callf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub call_filter: LiteralTree<CallLiteral>,
    /// the filters that should be applied to foreign entity records
    #[serde(default, rename = "fef")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub foreign_entity_filter: LiteralTree<ForeignEntityLiteral>,
    /// the filters that should be applied based on entity properties
    #[serde(default, rename = "propf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub properties_filter: LiteralTree<PropertiesLiteral>,
}

impl EntityFilterAst {
    /// expand the input [EntityFilters] into an ast representation
    pub fn new_from_filters(entity_filter: EntityFilters) -> Result<Option<Self>, ExpandErr> {
        if entity_filter.is_empty() {
            return Ok(None);
        }
        // The crm_* lists are processed twice: once here to extract the
        // tag, and once inside EmailFilters::expand_ast for the AST tree.
        // Both call the same `expand_crm_scope` helper, so validation is
        // deterministic and identical.
        let crm_scope = email::expand_crm_scope(
            entity_filter.email_filters.crm_domains.clone(),
            entity_filter.email_filters.crm_addresses.clone(),
        )?
        .map(|(_, scope)| scope);
        let email_tree = EmailFilters::expand_ast(entity_filter.email_filters)?.map(Arc::new);
        Ok(Some(EntityFilterAst {
            document_filter: DocumentFilters::expand_ast(entity_filter.document_filters)?
                .map(Arc::new),
            project_filter: ProjectFilters::expand_ast(entity_filter.project_filters)?
                .map(Arc::new),
            chat_filter: ChatFilters::expand_ast(entity_filter.chat_filters)?.map(Arc::new),
            email_filter: EmailFilterAst {
                tree: email_tree,
                crm_scope,
            },
            channel_filter: ChannelFilters::expand_ast(entity_filter.channel_filters)?
                .map(Arc::new),
            call_filter: CallFilters::expand_ast(entity_filter.call_filters)?.map(Arc::new),
            foreign_entity_filter: ForeignEntityFilters::expand_ast(
                entity_filter.foreign_entity_filters,
            )?
            .map(Arc::new),
            properties_filter: Vec::<PropertyFilter>::expand_ast(entity_filter.property_filters)?
                .map(Arc::new),
        }))
    }

    /// mock function to create the an empty ast
    #[cfg(feature = "mock")]
    pub fn mock_empty() -> Self {
        Self {
            document_filter: None,
            project_filter: None,
            chat_filter: None,
            email_filter: EmailFilterAst::default(),
            channel_filter: None,
            call_filter: None,
            foreign_entity_filter: None,
            properties_filter: None,
        }
    }
}

impl IsEmpty for EntityFilterAst {
    fn is_empty(&self) -> bool {
        let EntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            call_filter,
            foreign_entity_filter,
            properties_filter,
        } = self;
        document_filter.is_none()
            && project_filter.is_none()
            && chat_filter.is_none()
            && email_filter.is_empty()
            && channel_filter.is_none()
            && call_filter.is_none()
            && foreign_entity_filter.is_none()
            && properties_filter.is_none()
    }
}
