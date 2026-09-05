//! Versioned flat Soup eligibility and compilation into the generic predicate IR.
#![deny(missing_docs)]

use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use predicate_index::{
    ExactValue, IndexQuery, PartitionPredicate, PredicateExpr, Profile, RangeBound, SortDirection,
    Token, ValidatedIndexQuery, ValidationError, utc_timestamp_micros,
};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Stable direct-field profile name retained for existing browser projections.
pub const SOUP_FLAT_V1: &str = "soup-flat-v1";
/// Stable server-minted profile containing exact derived document facts.
pub const SOUP_FLAT_V2: &str = "soup-flat-v2";
/// Stable server-minted profile containing viewer-relative task facts.
pub const SOUP_FLAT_V3: &str = "soup-flat-v3";

// Keep this lightweight crate wasm-compatible instead of depending on the
// native `system_properties` crate. A native test locks this stable UUID to
// `SystemPropertyKey::STATUS_UUID`.
const STATUS_PROPERTY_DEFINITION_ID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000002);

/// Opaque vocabulary shared with direct Soup projection generation.
pub mod vocabulary {
    use predicate_index::{Profile, Token};

    use crate::{SOUP_FLAT_V1, SOUP_FLAT_V2, SOUP_FLAT_V3};

    fn token(value: &str) -> Token {
        Token::new(value).expect("static item-filter-index token is valid")
    }

    /// `soup-flat-v1` profile.
    pub fn profile() -> Profile {
        Profile::new(token(SOUP_FLAT_V1))
    }

    /// Server-minted `soup-flat-v2` profile.
    pub fn profile_v2() -> Profile {
        Profile::new(token(SOUP_FLAT_V2))
    }

    /// Server-minted `soup-flat-v3` profile.
    pub fn profile_v3() -> Profile {
        Profile::new(token(SOUP_FLAT_V3))
    }

    /// Document partition.
    pub fn document_partition() -> Token {
        token("document")
    }

    /// Project partition.
    pub fn project_partition() -> Token {
        token("project")
    }

    /// Chat partition.
    pub fn chat_partition() -> Token {
        token("chat")
    }

    /// Record identity attribute.
    pub fn id() -> Token {
        token("id")
    }

    /// Parent/project attribute.
    pub fn project_id() -> Token {
        token("project-id")
    }

    /// Owner attribute.
    pub fn owner() -> Token {
        token("owner")
    }

    /// Document file-type attribute.
    pub fn file_type() -> Token {
        token("file-type")
    }

    /// Canonical document subtype attribute.
    pub fn document_sub_type() -> Token {
        token("document-sub-type")
    }

    /// Explicit document email-attachment Boolean attribute.
    pub fn email_attachment() -> Token {
        token("email-attachment")
    }

    /// Viewer-relative document importance Boolean attribute.
    pub fn importance() -> Token {
        token("importance")
    }

    /// One authoritative task status select-option UUID.
    pub fn task_status_option() -> Token {
        token("task-status-option")
    }

    /// Creation timestamp and sort attribute.
    pub fn created_at() -> Token {
        token("created-at")
    }

    /// Update timestamp and sort attribute.
    pub fn updated_at() -> Token {
        token("updated-at")
    }
}

/// Sort methods understood by the local support profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoupIndexSort {
    /// Creation timestamp.
    CreatedAt,
    /// Update timestamp.
    UpdatedAt,
    /// A server sort not supported by the local flat Soup profiles.
    Unsupported,
}

/// Complete request options relevant to local eligibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoupFlatRequest {
    /// Requested sort.
    pub sort: SoupIndexSort,
    /// Requested sort direction.
    pub direction: SortDirection,
    /// Initial-page limit.
    pub limit: u16,
    /// Whether the request is a continuation.
    pub has_cursor: bool,
}

/// Why a well-formed request must use the authoritative network path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedReason {
    /// The request includes or fails to exclude a deferred entity partition.
    Partition(&'static str),
    /// A supported partition contains a deferred literal.
    Literal(&'static str),
    /// A global property predicate is present.
    GlobalProperties,
    /// The requested sort is not indexed.
    Sort,
    /// Local continuation cursors are not supported.
    Cursor,
}

/// Eligibility outcome before compilation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eligibility {
    /// Every request component is supported.
    Supported,
    /// The complete request must fall back.
    Unsupported(UnsupportedReason),
}

/// Typed compiler outcome used by browser composition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalCompileOutcome {
    /// Complete validated generic query.
    Supported(ValidatedIndexQuery),
    /// The complete request must use the network path.
    Unsupported(UnsupportedReason),
}

/// Malformed or oversized input that cannot be compiled.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum CompileError {
    /// Generic IR validation failed.
    #[error(transparent)]
    Validation(#[from] ValidationError),
}

/// Check the complete materialized forest against the direct-field v1 profile.
pub fn check_soup_flat_v1(ast: &EntityFilterAst, request: SoupFlatRequest) -> Eligibility {
    check_soup_flat(ast, request, supported_document_literal_v1, false)
}

/// Check the complete materialized forest against the server-minted v2 profile.
pub fn check_soup_flat_v2(ast: &EntityFilterAst, request: SoupFlatRequest) -> Eligibility {
    check_soup_flat(ast, request, supported_document_literal_v2, false)
}

/// Check the complete materialized forest against the server-minted v3 profile.
pub fn check_soup_flat_v3(ast: &EntityFilterAst, request: SoupFlatRequest) -> Eligibility {
    check_soup_flat(ast, request, supported_document_literal_v3, true)
}

fn check_soup_flat(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
    supported_document_literal: impl Fn(&DocumentLiteral) -> bool + Copy,
    supports_status_properties: bool,
) -> Eligibility {
    if request.has_cursor {
        return Eligibility::Unsupported(UnsupportedReason::Cursor);
    }
    if request.sort == SoupIndexSort::Unsupported {
        return Eligibility::Unsupported(UnsupportedReason::Sort);
    }
    if let Some(properties_filter) = ast.properties_filter.as_deref()
        && (!supports_status_properties
            || !supported_expr(Some(properties_filter), supported_status_property_literal)
            || !ast.project_filter.as_deref().is_some_and(|expr| {
                proves_none(expr, |literal| {
                    matches!(
                        literal,
                        ProjectLiteral::ProjectId(id) | ProjectLiteral::ProjectIdSelf(id)
                            if id.is_nil()
                    )
                })
            })
            || !ast.chat_filter.as_deref().is_some_and(|expr| {
                proves_none(expr, |literal| {
                    matches!(
                        literal,
                        ChatLiteral::ChatId(id) | ChatLiteral::ProjectId(id) if id.is_nil()
                    )
                })
            }))
    {
        // v3 carries task status facts only for Documents. Requiring the other
        // locally indexed partitions to be provably empty preserves the
        // server's global property-filter semantics without fabricating facts.
        return Eligibility::Unsupported(UnsupportedReason::GlobalProperties);
    }

    for result in [
        unsupported_partition(
            ast.calendar_event_filter.as_deref(),
            "calendarEvent",
            |literal| matches!(literal, CalendarEventLiteral::Id(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.email_filter.tree.as_deref(),
            "email",
            |literal| matches!(literal, EmailLiteral::ThreadId(id) if id.is_nil()),
        ),
        if ast.email_filter.crm_scope.is_some() {
            Err(UnsupportedReason::Partition("email"))
        } else {
            Ok(())
        },
        unsupported_partition(
            ast.channel_filter.as_deref(),
            "channel",
            |literal| matches!(literal, ChannelLiteral::ChannelId(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.channel_thread_filter.as_deref(),
            "channelThread",
            |literal| matches!(literal, ChannelThreadLiteral::ThreadId(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.call_filter.as_deref(),
            "call",
            |literal| matches!(literal, CallLiteral::CallId(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.crm_company_filter.as_deref(),
            "crmCompany",
            |literal| matches!(literal, CrmCompanyLiteral::Id(id) if id.is_nil()),
        ),
        unsupported_partition(
            ast.foreign_entity_filter.as_deref(),
            "foreignEntity",
            |literal| matches!(literal, ForeignEntityLiteral::Id(id) if id.is_nil()),
        ),
    ] {
        if let Err(reason) = result {
            return Eligibility::Unsupported(reason);
        }
    }

    // Reminders are uniquely excluded by Soup when their tree is omitted.
    if ast.reminder_filter.is_some() {
        return Eligibility::Unsupported(UnsupportedReason::Partition("reminder"));
    }

    if !supported_expr(ast.document_filter.as_deref(), supported_document_literal)
        || (supports_status_properties
            && !supported_v3_importance_shape(ast.document_filter.as_deref(), false))
    {
        return Eligibility::Unsupported(UnsupportedReason::Literal("document"));
    }
    if !supported_expr(ast.project_filter.as_deref(), supported_project_literal) {
        return Eligibility::Unsupported(UnsupportedReason::Literal("project"));
    }
    if !supported_expr(ast.chat_filter.as_deref(), supported_chat_literal) {
        return Eligibility::Unsupported(UnsupportedReason::Literal("chat"));
    }

    Eligibility::Supported
}

/// Compile a request against the direct-field v1 profile.
pub fn compile_soup_flat_v1(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
) -> Result<LocalCompileOutcome, CompileError> {
    compile_soup_flat(
        ast,
        request,
        vocabulary::profile(),
        supported_document_literal_v1,
        compile_document_literal_v1,
        None,
    )
}

/// Compile a request against the server-minted v2 profile.
pub fn compile_soup_flat_v2(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
) -> Result<LocalCompileOutcome, CompileError> {
    compile_soup_flat(
        ast,
        request,
        vocabulary::profile_v2(),
        supported_document_literal_v2,
        compile_document_literal_v2,
        None,
    )
}

/// Compile a request against the viewer-relative server-minted v3 profile.
pub fn compile_soup_flat_v3(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
) -> Result<LocalCompileOutcome, CompileError> {
    compile_soup_flat(
        ast,
        request,
        vocabulary::profile_v3(),
        supported_document_literal_v3,
        compile_document_literal_v3,
        Some(compile_status_property_literal),
    )
}

type PropertyLiteralCompiler = fn(&PropertiesLiteral) -> Result<PredicateExpr, CompileError>;

fn compile_soup_flat(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
    profile: Profile,
    supported_document_literal: impl Fn(&DocumentLiteral) -> bool + Copy,
    compile_document_literal: impl Fn(&DocumentLiteral) -> Result<PredicateExpr, CompileError> + Copy,
    compile_properties_literal: Option<PropertyLiteralCompiler>,
) -> Result<LocalCompileOutcome, CompileError> {
    if let Eligibility::Unsupported(reason) = check_soup_flat(
        ast,
        request,
        supported_document_literal,
        compile_properties_literal.is_some(),
    ) {
        return Ok(LocalCompileOutcome::Unsupported(reason));
    }

    let sort_attribute = match request.sort {
        SoupIndexSort::CreatedAt => vocabulary::created_at(),
        SoupIndexSort::UpdatedAt => vocabulary::updated_at(),
        SoupIndexSort::Unsupported => unreachable!("eligibility checked sort"),
    };
    let mut document_predicate =
        compile_expr(ast.document_filter.as_deref(), compile_document_literal)?;
    if let Some(properties_filter) = ast.properties_filter.as_deref() {
        let compile_properties_literal =
            compile_properties_literal.expect("eligibility checked property support");
        document_predicate = PredicateExpr::And(
            Box::new(document_predicate),
            Box::new(compile_expr(
                Some(properties_filter),
                compile_properties_literal,
            )?),
        );
    }

    let query = IndexQuery {
        profile,
        partitions: vec![
            PartitionPredicate {
                partition: vocabulary::document_partition(),
                predicate: document_predicate,
            },
            PartitionPredicate {
                partition: vocabulary::project_partition(),
                predicate: compile_expr(ast.project_filter.as_deref(), compile_project_literal)?,
            },
            PartitionPredicate {
                partition: vocabulary::chat_partition(),
                predicate: compile_expr(ast.chat_filter.as_deref(), compile_chat_literal)?,
            },
        ],
        sort_attribute,
        sort_direction: request.direction,
        tie_break_direction: request.direction,
        limit: request.limit,
    };

    Ok(LocalCompileOutcome::Supported(ValidatedIndexQuery::new(
        query,
    )?))
}

fn unsupported_partition<T>(
    expr: Option<&Expr<T>>,
    name: &'static str,
    is_positive_nil_id: impl Fn(&T) -> bool + Copy,
) -> Result<(), UnsupportedReason> {
    match expr {
        Some(expr) if proves_none(expr, is_positive_nil_id) => Ok(()),
        Some(_) | None => Err(UnsupportedReason::Partition(name)),
    }
}

fn proves_none<T>(expr: &Expr<T>, is_positive_nil_id: impl Fn(&T) -> bool + Copy) -> bool {
    match expr {
        Expr::Literal(literal) => is_positive_nil_id(literal),
        Expr::And(left, right) => {
            proves_none(left, is_positive_nil_id) || proves_none(right, is_positive_nil_id)
        }
        Expr::Or(_, _) | Expr::Not(_) => false,
    }
}

fn supported_expr<T>(expr: Option<&Expr<T>>, supported: impl Fn(&T) -> bool + Copy) -> bool {
    match expr {
        None => true,
        Some(Expr::Literal(literal)) => supported(literal),
        Some(Expr::And(left, right) | Expr::Or(left, right)) => {
            supported_expr(Some(left), supported) && supported_expr(Some(right), supported)
        }
        Some(Expr::Not(expr)) => supported_expr(Some(expr), supported),
    }
}

fn supported_document_literal_v1(literal: &DocumentLiteral) -> bool {
    matches!(
        literal,
        DocumentLiteral::Id(_)
            | DocumentLiteral::FileType(_)
            | DocumentLiteral::ProjectId(_)
            | DocumentLiteral::Owner(_)
            | DocumentLiteral::CreatedAt(_)
            | DocumentLiteral::UpdatedAt(_)
    )
}

fn supported_document_literal_v2(literal: &DocumentLiteral) -> bool {
    supported_document_literal_v1(literal)
        || matches!(
            literal,
            DocumentLiteral::SubType(_) | DocumentLiteral::IsEmailAttachment(_)
        )
}

fn supported_document_literal_v3(literal: &DocumentLiteral) -> bool {
    supported_document_literal_v2(literal) || matches!(literal, DocumentLiteral::Importance(true))
}

fn supported_v3_importance_shape(expr: Option<&Expr<DocumentLiteral>>, negated: bool) -> bool {
    match expr {
        None => true,
        Some(Expr::Literal(DocumentLiteral::Importance(value))) => *value && !negated,
        Some(Expr::Literal(_)) => true,
        Some(Expr::And(left, right) | Expr::Or(left, right)) => {
            supported_v3_importance_shape(Some(left), negated)
                && supported_v3_importance_shape(Some(right), negated)
        }
        Some(Expr::Not(expr)) => supported_v3_importance_shape(Some(expr), !negated),
    }
}

fn supported_status_property_literal(literal: &PropertiesLiteral) -> bool {
    literal.property_definition_id == STATUS_PROPERTY_DEFINITION_ID
        && literal
            .entity_type
            .is_none_or(|entity_type| entity_type == PropertyEntityType::Task)
        && matches!(literal.value, PropertyMatchValue::SelectOption(_))
}

fn supported_project_literal(literal: &ProjectLiteral) -> bool {
    matches!(
        literal,
        ProjectLiteral::ProjectId(_)
            | ProjectLiteral::ProjectIdSelf(_)
            | ProjectLiteral::Owner(_)
            | ProjectLiteral::CreatedAt(_)
            | ProjectLiteral::UpdatedAt(_)
    )
}

fn supported_chat_literal(literal: &ChatLiteral) -> bool {
    matches!(
        literal,
        ChatLiteral::ChatId(_)
            | ChatLiteral::ProjectId(_)
            | ChatLiteral::Owner(_)
            | ChatLiteral::CreatedAt(_)
            | ChatLiteral::UpdatedAt(_)
    )
}

fn compile_expr<T>(
    expr: Option<&Expr<T>>,
    literal: impl Fn(&T) -> Result<PredicateExpr, CompileError> + Copy,
) -> Result<PredicateExpr, CompileError> {
    Ok(match expr {
        None => PredicateExpr::All,
        Some(Expr::Literal(value)) => literal(value)?,
        Some(Expr::And(left, right)) => PredicateExpr::And(
            Box::new(compile_expr(Some(left), literal)?),
            Box::new(compile_expr(Some(right), literal)?),
        ),
        Some(Expr::Or(left, right)) => PredicateExpr::Or(
            Box::new(compile_expr(Some(left), literal)?),
            Box::new(compile_expr(Some(right), literal)?),
        ),
        Some(Expr::Not(expr)) => PredicateExpr::Not(Box::new(compile_expr(Some(expr), literal)?)),
    })
}

fn compile_document_literal_v1(literal: &DocumentLiteral) -> Result<PredicateExpr, CompileError> {
    compile_document_literal(literal, false, false)
}

fn compile_document_literal_v2(literal: &DocumentLiteral) -> Result<PredicateExpr, CompileError> {
    compile_document_literal(literal, true, false)
}

fn compile_document_literal_v3(literal: &DocumentLiteral) -> Result<PredicateExpr, CompileError> {
    compile_document_literal(literal, true, true)
}

fn compile_document_literal(
    literal: &DocumentLiteral,
    supports_v2_facts: bool,
    supports_v3_facts: bool,
) -> Result<PredicateExpr, CompileError> {
    Ok(match literal {
        DocumentLiteral::Id(id) => exact_uuid(vocabulary::id(), id),
        DocumentLiteral::FileType(file_type) => {
            return exact_utf8(vocabulary::file_type(), file_type.to_string());
        }
        DocumentLiteral::ProjectId(id) => exact_uuid(vocabulary::project_id(), id),
        DocumentLiteral::Owner(owner) => {
            return exact_utf8(vocabulary::owner(), owner.to_string());
        }
        DocumentLiteral::SubType(sub_type) if supports_v2_facts => {
            return exact_utf8(vocabulary::document_sub_type(), sub_type.to_string());
        }
        DocumentLiteral::IsEmailAttachment(value) if supports_v2_facts => PredicateExpr::Exact {
            attribute: vocabulary::email_attachment(),
            value: ExactValue::new([u8::from(*value)])
                .expect("canonical Boolean exact value is bounded"),
        },
        DocumentLiteral::Importance(value) if supports_v3_facts => PredicateExpr::Exact {
            attribute: vocabulary::importance(),
            value: ExactValue::new([u8::from(*value)])
                .expect("canonical Boolean exact value is bounded"),
        },
        DocumentLiteral::CreatedAt(date) => date_expr(vocabulary::created_at(), date),
        DocumentLiteral::UpdatedAt(date) => date_expr(vocabulary::updated_at(), date),
        _ => unreachable!("eligibility checked document literal"),
    })
}

fn compile_status_property_literal(
    literal: &PropertiesLiteral,
) -> Result<PredicateExpr, CompileError> {
    let PropertyMatchValue::SelectOption(option_id) = &literal.value else {
        unreachable!("eligibility checked status property value");
    };
    Ok(exact_uuid(vocabulary::task_status_option(), option_id))
}

fn compile_project_literal(literal: &ProjectLiteral) -> Result<PredicateExpr, CompileError> {
    Ok(match literal {
        ProjectLiteral::ProjectId(id) => exact_uuid(vocabulary::project_id(), id),
        ProjectLiteral::ProjectIdSelf(id) => exact_uuid(vocabulary::id(), id),
        ProjectLiteral::Owner(owner) => {
            return exact_utf8(vocabulary::owner(), owner.to_string());
        }
        ProjectLiteral::CreatedAt(date) => date_expr(vocabulary::created_at(), date),
        ProjectLiteral::UpdatedAt(date) => date_expr(vocabulary::updated_at(), date),
        _ => unreachable!("eligibility checked project literal"),
    })
}

fn compile_chat_literal(literal: &ChatLiteral) -> Result<PredicateExpr, CompileError> {
    Ok(match literal {
        ChatLiteral::ChatId(id) => exact_uuid(vocabulary::id(), id),
        ChatLiteral::ProjectId(id) => exact_uuid(vocabulary::project_id(), id),
        ChatLiteral::Owner(owner) => {
            return exact_utf8(vocabulary::owner(), owner.to_string());
        }
        ChatLiteral::CreatedAt(date) => date_expr(vocabulary::created_at(), date),
        ChatLiteral::UpdatedAt(date) => date_expr(vocabulary::updated_at(), date),
        _ => unreachable!("eligibility checked chat literal"),
    })
}

fn exact_uuid(attribute: Token, value: &Uuid) -> PredicateExpr {
    PredicateExpr::Exact {
        attribute,
        value: ExactValue::new(value.as_bytes()).expect("UUID exact value is bounded"),
    }
}

fn exact_utf8(attribute: Token, value: impl AsRef<str>) -> Result<PredicateExpr, CompileError> {
    Ok(PredicateExpr::Exact {
        attribute,
        value: ExactValue::utf8(value)?,
    })
}

fn date_expr(attribute: Token, date: &DateLiteral) -> PredicateExpr {
    let (lower, upper) = match date {
        DateLiteral::GreaterThan(value) => (
            Some(RangeBound::Exclusive(utc_timestamp_micros(*value))),
            None,
        ),
        DateLiteral::LessThan(value) => (
            None,
            Some(RangeBound::Exclusive(utc_timestamp_micros(*value))),
        ),
        DateLiteral::GreaterThanOrEqual(value) => (
            Some(RangeBound::Inclusive(utc_timestamp_micros(*value))),
            None,
        ),
        DateLiteral::LessThanOrEqual(value) => (
            None,
            Some(RangeBound::Inclusive(utc_timestamp_micros(*value))),
        ),
    };
    PredicateExpr::I64Range {
        attribute,
        lower,
        upper,
    }
}
