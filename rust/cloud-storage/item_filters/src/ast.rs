//! This module defines stricter typing for the filters found in lib.
//! This is used to construct a strictly typed ast for the input filters, allowing consumers to have a logical represenation of the required operations

use crate::{
    CallFilters, ChannelFilters, ChatFilters, DocumentFilters, EmailFilters, EntityFilters,
    ProjectFilters, PropertyFilter,
    ast::{
        call::CallLiteral,
        channel::{ChannelLiteral, ChannelTypeFilter},
        chat::{ChatLiteral, ChatRole},
        email::EmailLiteral,
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
/// Mutually exclusive: at most one of `domains` / `addresses` is non-empty.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum CrmScope {
    /// caller is asking for team-visible threads involving any of these domains
    Domains(Vec<String>),
    /// caller is asking for team-visible threads involving any of these addresses
    Addresses(Vec<String>),
}

impl CrmScope {
    /// Extract a [`CrmScope`] from the raw filter, validating mutual
    /// exclusivity. Per-value validation (parseability) lives in
    /// [`crate::EmailFilters::expand_ast`].
    pub fn from_email_filters(filters: &crate::EmailFilters) -> Result<Option<Self>, ExpandErr> {
        let has_domains = !filters.crm_domains.is_empty();
        let has_addresses = !filters.crm_addresses.is_empty();
        match (has_domains, has_addresses) {
            (false, false) => Ok(None),
            (true, false) => Ok(Some(CrmScope::Domains(
                filters
                    .crm_domains
                    .iter()
                    .map(|s| s.to_lowercase())
                    .collect(),
            ))),
            (false, true) => Ok(Some(CrmScope::Addresses(
                filters
                    .crm_addresses
                    .iter()
                    .map(|s| s.to_lowercase())
                    .collect(),
            ))),
            (true, true) => Err(ExpandErr::CrmDomainsAndAddressesMutuallyExclusive),
        }
    }
}

/// type alias for a maybe empty, cheaply cloneable ast literal tree
pub type LiteralTree<T> = Option<Arc<Expr<T>>>;

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
    /// the filters that should be applied to the email entity
    #[serde(default, rename = "ef")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub email_filter: LiteralTree<EmailLiteral>,
    /// the filters that should be applied to the channel entity
    #[serde(default, rename = "chanf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub channel_filter: LiteralTree<ChannelLiteral>,
    /// the filters that should be applied to the call entity
    #[serde(default, rename = "callf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub call_filter: LiteralTree<CallLiteral>,
    /// the filters that should be applied based on entity properties
    #[serde(default, rename = "propf")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub properties_filter: LiteralTree<PropertiesLiteral>,
    /// CRM scope tag for the email entity, when the request asks for a
    /// CRM-authorized team-scoped view. Set from [`crate::EmailFilters::crm_domains`]
    /// / [`crate::EmailFilters::crm_addresses`] during expansion. The email
    /// service uses this to drive authorization and candidate-set widening.
    #[serde(default, rename = "ecrm", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "schema", schema(value_type = serde_json::Value))]
    pub email_crm_scope: Option<CrmScope>,
}

impl EntityFilterAst {
    /// expand the input [EntityFilters] into an ast representation
    pub fn new_from_filters(entity_filter: EntityFilters) -> Result<Option<Self>, ExpandErr> {
        if entity_filter.is_empty() {
            return Ok(None);
        }
        let email_crm_scope = CrmScope::from_email_filters(&entity_filter.email_filters)?;
        Ok(Some(EntityFilterAst {
            document_filter: DocumentFilters::expand_ast(entity_filter.document_filters)?
                .map(Arc::new),
            project_filter: ProjectFilters::expand_ast(entity_filter.project_filters)?
                .map(Arc::new),
            chat_filter: ChatFilters::expand_ast(entity_filter.chat_filters)?.map(Arc::new),
            email_filter: EmailFilters::expand_ast(entity_filter.email_filters)?.map(Arc::new),
            channel_filter: ChannelFilters::expand_ast(entity_filter.channel_filters)?
                .map(Arc::new),
            call_filter: CallFilters::expand_ast(entity_filter.call_filters)?.map(Arc::new),
            properties_filter: Vec::<PropertyFilter>::expand_ast(entity_filter.property_filters)?
                .map(Arc::new),
            email_crm_scope,
        }))
    }

    /// mock function to create the an empty ast
    #[cfg(feature = "mock")]
    pub fn mock_empty() -> Self {
        Self {
            document_filter: None,
            project_filter: None,
            chat_filter: None,
            email_filter: None,
            channel_filter: None,
            call_filter: None,
            properties_filter: None,
            email_crm_scope: None,
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
            properties_filter,
            email_crm_scope,
        } = self;
        document_filter.is_none()
            && project_filter.is_none()
            && chat_filter.is_none()
            && email_filter.is_none()
            && channel_filter.is_none()
            && call_filter.is_none()
            && properties_filter.is_none()
            && email_crm_scope.is_none()
    }
}
