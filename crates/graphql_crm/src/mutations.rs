use std::{future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::{Context, ErrorExtensions, ID, InputObject, Object};
use crm::domain::{
    auth::{CrmCompanyReceipt, CrmTeamReceipt},
    model::{CrmContact, CrmError},
    service::CrmService,
};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use graphql_common::require_authenticated_user;
use graphql_entity_mutation::GraphqlEntityMutationResult;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

/// Manual company creation request.
#[derive(InputObject)]
struct CreateCrmCompanyInput {
    /// Client-generated request ID, retained across retries of this write.
    request_id: ID,
    /// Display name of the company.
    name: String,
    /// Optional company's website domain.
    domain: Option<String>,
}

/// Manual contact creation request.
#[derive(InputObject)]
struct CreateCrmContactInput {
    /// Client-generated request ID, retained across retries of this write.
    request_id: ID,
    /// Display name of the contact.
    name: String,
    /// Optional contact email address.
    email: Option<String>,
    /// Existing parent company. When omitted, the team may file the contact by email domain.
    company_id: Option<ID>,
}

/// The persisted record identity and its normalized Soup effects.
struct CreateCrmRecordPayload<E: SoupEntityEdges> {
    record_id: ID,
    result: GraphqlEntityMutationResult<E>,
}

#[Object]
impl<E: SoupEntityEdges> CreateCrmRecordPayload<E> {
    /// ID of the created record.
    async fn record_id(&self) -> &ID {
        &self.record_id
    }

    /// Cache effects, including the parent company when a team contact files there by domain.
    async fn result(&self) -> Option<&GraphqlEntityMutationResult<E>> {
        // The write and its ID have committed even if an effect cannot be hydrated.
        Some(&self.result)
    }
}

/// GraphQL root for CRM record creation.
pub struct CrmMutationRoot<E>(PhantomData<E>);

impl<E> Default for CrmMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Object]
impl<E: SoupEntityEdges> CrmMutationRoot<E> {
    /// Create a company for the authenticated user's team.
    #[tracing::instrument(name = "crm.create_company", skip_all, err(Debug), fields(company_id = tracing::field::Empty))]
    async fn create_crm_company(
        &self,
        ctx: &Context<'_>,
        input: CreateCrmCompanyInput,
    ) -> async_graphql::Result<CreateCrmRecordPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let id = ctx
            .data::<CrmMutationContext>()?
            .0
            .create_company(user, input)
            .await?;
        tracing::Span::current().record("company_id", tracing::field::display(id));
        Ok(CreateCrmRecordPayload {
            record_id: ID(id.to_string()),
            result: GraphqlEntityMutationResult::from_updated_entity(
                EntityType::CrmCompany.with_entity_string(id.to_string()),
            ),
        })
    }

    /// Create a contact for a visible company or for the authenticated user's team.
    #[tracing::instrument(name = "crm.create_contact", skip_all, err(Debug), fields(contact_id = tracing::field::Empty))]
    async fn create_crm_contact(
        &self,
        ctx: &Context<'_>,
        input: CreateCrmContactInput,
    ) -> async_graphql::Result<CreateCrmRecordPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let team_contact = input.company_id.is_none();
        let contact = ctx
            .data::<CrmMutationContext>()?
            .0
            .create_contact(user, input)
            .await?;
        tracing::Span::current().record("contact_id", tracing::field::display(contact.id));
        // A team contact can create its own company. Resend the parent effect
        // on replay too, even when the first response was lost after commit.
        let company = contact.company_id.filter(|_| team_contact);
        let effects =
            std::iter::once(EntityType::CrmContact.with_entity_string(contact.id.to_string()))
                .chain(company.map(|id| EntityType::CrmCompany.with_entity_string(id.to_string())));
        Ok(CreateCrmRecordPayload {
            record_id: ID(contact.id.to_string()),
            result: GraphqlEntityMutationResult::from_updated_entities(effects),
        })
    }
}

/// CRM writes composed from the same service and receipt issuer as the REST routes.
#[derive(Clone)]
pub struct CrmMutationContext(Arc<dyn CrmWriteApi>);

impl CrmMutationContext {
    /// Compose the authorized write service for GraphQL requests.
    pub fn new<C: CrmService, A: EntityAccessService>(crm: Arc<C>, access: Arc<A>) -> Self {
        Self(Arc::new(CrmWriteAdapter { crm, access }))
    }
}

type WriteFuture<'a, T> = Pin<Box<dyn Future<Output = async_graphql::Result<T>> + Send + 'a>>;

trait CrmWriteApi: Send + Sync {
    fn create_company(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CreateCrmCompanyInput,
    ) -> WriteFuture<'_, Uuid>;

    fn create_contact(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CreateCrmContactInput,
    ) -> WriteFuture<'_, CrmContact>;
}

struct CrmWriteAdapter<C, A> {
    crm: Arc<C>,
    access: Arc<A>,
}

impl<C: CrmService, A: EntityAccessService> CrmWriteApi for CrmWriteAdapter<C, A> {
    fn create_company(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CreateCrmCompanyInput,
    ) -> WriteFuture<'_, Uuid> {
        Box::pin(async move {
            let id = parse_id(&input.request_id, "requestId")?;
            let receipt = CrmTeamReceipt::for_user(self.access.as_ref(), viewer)
                .await
                .map_err(|error| access_error(error, "FORBIDDEN"))?;
            let company = self
                .crm
                .create_company_with_request_id(
                    &receipt,
                    &input.name,
                    input.domain.as_deref(),
                    Some(id),
                )
                .await
                .map_err(write_error)?;
            Ok(company.company.id)
        })
    }

    fn create_contact(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CreateCrmContactInput,
    ) -> WriteFuture<'_, CrmContact> {
        Box::pin(async move {
            let id = parse_id(&input.request_id, "requestId")?;
            let email = input.email.as_deref();
            let result = if let Some(company_id) = input.company_id {
                let company_id = parse_id(&company_id, "companyId")?;
                let receipt = CrmCompanyReceipt::for_user(
                    self.access.as_ref(),
                    viewer,
                    &company_id.to_string(),
                )
                .await
                .map_err(|error| access_error(error, "NOT_FOUND"))?;
                self.crm
                    .create_contact_with_request_id(&receipt, &input.name, email, Some(id))
                    .await
            } else {
                let receipt = CrmTeamReceipt::for_user(self.access.as_ref(), viewer)
                    .await
                    .map_err(|error| access_error(error, "FORBIDDEN"))?;
                self.crm
                    .create_team_contact_with_request_id(&receipt, &input.name, email, Some(id))
                    .await
            };
            result.map_err(write_error)
        })
    }
}

fn parse_id(id: &ID, field: &str) -> async_graphql::Result<Uuid> {
    Uuid::parse_str(id.as_str())
        .ok()
        .filter(|id| !id.is_nil())
        .ok_or_else(|| coded_error(format!("invalid {field}"), "BAD_REQUEST"))
}

fn access_error(error: AccessError, denied_code: &'static str) -> async_graphql::Error {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            coded_error("CRM record is not accessible", denied_code)
        }
        AccessError::NotFound(_) => coded_error("CRM record is not accessible", "NOT_FOUND"),
        AccessError::BadRequest(message) => coded_error(message, "BAD_REQUEST"),
        error => {
            tracing::error!(?error, "CRM create access check failed");
            coded_error("CRM create failed", "INTERNAL_SERVER_ERROR")
        }
    }
}

fn write_error(error: CrmError) -> async_graphql::Error {
    let code = match &error {
        CrmError::CrmDisabledForTeam | CrmError::AccessDenied => "FORBIDDEN",
        CrmError::CompanyNotFoundForTeam | CrmError::ContactNotFoundForTeam => "NOT_FOUND",
        CrmError::InvalidRequest(_) => "BAD_REQUEST",
        CrmError::CompanyAlreadyExistsForTeam | CrmError::ContactAlreadyExistsForCompany => {
            "CONFLICT"
        }
        _ => {
            tracing::error!(?error, "CRM create failed");
            return coded_error("CRM create failed", "INTERNAL_SERVER_ERROR");
        }
    };
    coded_error(error.to_string(), code)
}

fn coded_error(message: impl Into<String>, code: &'static str) -> async_graphql::Error {
    async_graphql::Error::new(message).extend_with(|_, extensions| extensions.set("code", code))
}
