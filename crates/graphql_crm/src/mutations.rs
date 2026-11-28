use std::{future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::{Context, Enum, ErrorExtensions, ID, InputObject, Object, SimpleObject};
use crm::domain::{
    auth::{CrmCompanyReceipt, CrmTeamReceipt},
    model::{CrmContact, CrmDomain, CrmError},
    service::CrmService,
};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use graphql_common::require_authenticated_user;
use graphql_entity_mutation::GraphqlEntityMutationResult;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

mod record_merge;
use crm::domain::record_merge::service::RecordMerges;
use record_merge::{CommitCrmMergeInput, CrmMergePayload, CrmMergeWriteAdapter, CrmMergeWriteApi};

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

struct CreateCrmRecordPayload<E: SoupEntityEdges> {
    record_id: ID,
    result: GraphqlEntityMutationResult<E>,
}

/// The persisted record identity and its normalized Soup effects.
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

/// Rename a company's team-local display name.
#[derive(InputObject)]
struct RenameCrmCompanyInput {
    /// The company to rename.
    company_id: ID,
    /// The new display name.
    name: String,
}

/// Whether to associate or separate a website domain.
#[derive(Clone, Copy, Debug, Enum, Eq, PartialEq)]
enum CrmCompanyDomainChange {
    /// Associate the domain with the company.
    Add,
    /// Remove the domain from the company.
    Remove,
}

/// Change one company's website domains.
#[derive(InputObject)]
struct EditCrmCompanyDomainInput {
    /// The company whose domains change.
    company_id: ID,
    /// Website domain to add or remove.
    domain: String,
    /// The requested change.
    change: CrmCompanyDomainChange,
}

/// A domain assigned to a CRM company.
#[derive(SimpleObject)]
struct CrmCompanyDomain {
    /// The domain record's identifier.
    id: ID,
    /// The canonical domain name.
    domain: String,
    /// When the domain was assigned.
    created_at: String,
}

impl From<CrmDomain> for CrmCompanyDomain {
    fn from(domain: CrmDomain) -> Self {
        Self {
            id: ID(domain.id.to_string()),
            domain: domain.domain,
            created_at: domain.created_at.to_rfc3339(),
        }
    }
}

/// A committed company change and its normalized cache effects.
#[derive(SimpleObject)]
struct CrmCompanyEditPayload<E: SoupEntityEdges> {
    /// The current company identifier, after resolving any alias.
    company_id: ID,
    /// The persisted domains for a domain edit.
    domains: Option<Vec<CrmCompanyDomain>>,
    /// Primary Soup effects. The company edit has already committed if hydration fails.
    result: Option<GraphqlEntityMutationResult<E>>,
}

impl<E: SoupEntityEdges> CrmCompanyEditPayload<E> {
    fn new(company_id: ID, domains: Option<Vec<CrmCompanyDomain>>) -> Self {
        let result = GraphqlEntityMutationResult::from_updated_entity(
            EntityType::CrmCompany.with_entity_string(company_id.to_string()),
        );
        Self {
            company_id,
            domains,
            result: Some(result),
        }
    }
}

impl<E> Default for CrmMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Object]
impl<E: SoupEntityEdges> CrmMutationRoot<E> {
    /// Commit a previously reviewed CRM merge.
    #[tracing::instrument(name = "crm.commit_merge", skip_all, err(Debug), fields(survivor_id = %input.survivor_id.as_str()))]
    async fn commit_crm_merge(
        &self,
        ctx: &Context<'_>,
        input: CommitCrmMergeInput,
    ) -> async_graphql::Result<CrmMergePayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let outcome = ctx
            .data::<CrmMutationContext>()?
            .merges
            .as_ref()
            .ok_or_else(|| coded_error("CRM merge service unavailable", "INTERNAL_SERVER_ERROR"))?
            .commit(user, input)
            .await?;
        Ok(CrmMergePayload::from(outcome))
    }

    /// Change a CRM company's name for its owning team.
    #[tracing::instrument(name = "crm.rename_company", skip_all, err(Debug), fields(company_id = %input.company_id.as_str()))]
    async fn rename_crm_company(
        &self,
        ctx: &Context<'_>,
        input: RenameCrmCompanyInput,
    ) -> async_graphql::Result<CrmCompanyEditPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let id = ctx
            .data::<CrmMutationContext>()?
            .records
            .rename_company(user, input)
            .await?;
        Ok(CrmCompanyEditPayload::new(id, None))
    }

    /// Add or remove a website domain from a CRM company.
    #[tracing::instrument(name = "crm.edit_company_domain", skip_all, err(Debug), fields(company_id = %input.company_id.as_str(), change = ?input.change))]
    async fn edit_crm_company_domain(
        &self,
        ctx: &Context<'_>,
        input: EditCrmCompanyDomainInput,
    ) -> async_graphql::Result<CrmCompanyEditPayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let company = ctx
            .data::<CrmMutationContext>()?
            .records
            .edit_company_domain(user, input)
            .await?;
        Ok(CrmCompanyEditPayload::new(
            ID(company.id.to_string()),
            Some(company.domains.into_iter().map(Into::into).collect()),
        ))
    }

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
            .records
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
            .records
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
pub struct CrmMutationContext {
    records: Arc<dyn CrmWriteApi>,
    merges: Option<Arc<dyn CrmMergeWriteApi>>,
}

impl CrmMutationContext {
    /// Compose the authorized write service for GraphQL requests.
    pub fn new<C: CrmService, A: EntityAccessService>(crm: Arc<C>, access: Arc<A>) -> Self {
        Self {
            records: Arc::new(CrmWriteAdapter { crm, access }),
            merges: None,
        }
    }

    /// Compose the same merge service used by the CRM REST adapter.
    pub fn with_merge_service<M: RecordMerges, A: EntityAccessService>(
        mut self,
        merges: Arc<M>,
        access: Arc<A>,
    ) -> Self {
        self.merges = Some(Arc::new(CrmMergeWriteAdapter { merges, access }));
        self
    }
}

type WriteFuture<'a, T> = Pin<Box<dyn Future<Output = async_graphql::Result<T>> + Send + 'a>>;

trait CrmWriteApi: Send + Sync {
    fn rename_company(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: RenameCrmCompanyInput,
    ) -> WriteFuture<'_, ID>;

    fn edit_company_domain(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: EditCrmCompanyDomainInput,
    ) -> WriteFuture<'_, crm::domain::model::CrmCompany>;

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
    fn rename_company(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: RenameCrmCompanyInput,
    ) -> WriteFuture<'_, ID> {
        Box::pin(async move {
            let company_id = parse_id(&input.company_id, "companyId")?;
            let receipt =
                CrmCompanyReceipt::for_user(self.access.as_ref(), viewer, &company_id.to_string())
                    .await
                    .map_err(|error| access_error(error, "NOT_FOUND"))?;
            self.crm
                .set_company_name(&receipt, &input.name)
                .await
                .map_err(write_error)?;
            Ok(ID(receipt.receipt().entity().entity_id.to_string()))
        })
    }

    fn edit_company_domain(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: EditCrmCompanyDomainInput,
    ) -> WriteFuture<'_, crm::domain::model::CrmCompany> {
        Box::pin(async move {
            let company_id = parse_id(&input.company_id, "companyId")?;
            let receipt =
                CrmCompanyReceipt::for_user(self.access.as_ref(), viewer, &company_id.to_string())
                    .await
                    .map_err(|error| access_error(error, "FORBIDDEN"))?;
            let result = match input.change {
                CrmCompanyDomainChange::Add => {
                    self.crm.add_company_domain(&receipt, &input.domain).await
                }
                CrmCompanyDomainChange::Remove => {
                    self.crm
                        .remove_company_domain(&receipt, &input.domain)
                        .await
                }
            };
            result.map(|company| company.company).map_err(write_error)
        })
    }

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
            tracing::error!(?error, "CRM write access check failed");
            coded_error("CRM write failed", "INTERNAL_SERVER_ERROR")
        }
    }
}

fn write_error(error: CrmError) -> async_graphql::Error {
    let code = match &error {
        CrmError::CrmDisabledForTeam
        | CrmError::AccessDenied
        | CrmError::CompanyDomainAdminRequired => "FORBIDDEN",
        CrmError::CompanyNotFoundForTeam | CrmError::ContactNotFoundForTeam => "NOT_FOUND",
        CrmError::InvalidRequest(_) => "BAD_REQUEST",
        CrmError::CompanyAlreadyExistsForTeam | CrmError::ContactAlreadyExistsForCompany => {
            "CONFLICT"
        }
        CrmError::CompanyDomainTaken(holder) => {
            return coded_error(error.to_string(), "CONFLICT").extend_with(|_, extensions| {
                if let Some(holder) = holder {
                    extensions.set("companyId", holder.company_id.to_string());
                    extensions.set("companyName", holder.name.clone());
                }
            });
        }
        _ => {
            tracing::error!(?error, "CRM write failed");
            return coded_error("CRM write failed", "INTERNAL_SERVER_ERROR");
        }
    };
    coded_error(error.to_string(), code)
}

fn coded_error(message: impl Into<String>, code: &'static str) -> async_graphql::Error {
    async_graphql::Error::new(message).extend_with(|_, extensions| extensions.set("code", code))
}
