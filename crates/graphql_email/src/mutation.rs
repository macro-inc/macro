use std::{future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::{Context, ID, InputObject, Object, OutputType};
use email::domain::{
    models::{EmailErr, UpdateThreadLabelsResult},
    ports::EmailService,
};
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Domain-facing capability required by email thread mutations.
pub trait EmailMutationService: Send + Sync + 'static {
    /// Mark an accessible email thread as seen by the authenticated user.
    fn mark_email_thread_seen(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;

    /// Add or remove one label from every message in an accessible email thread.
    fn update_email_thread_label(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    ) -> impl Future<Output = Result<UpdateThreadLabelsResult, EmailErr>> + Send;
}

impl<S> EmailMutationService for S
where
    S: EmailService,
{
    async fn mark_email_thread_seen(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        self.mark_thread_seen(user_id, thread_id).await
    }

    async fn update_email_thread_label(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.update_thread_labels_for_user(user_id, thread_id, label_id, value)
            .await
    }
}

/// Boxed future that reloads an email thread after a mutation.
pub type EmailThreadMutationLoadFuture<'ctx, T> =
    Pin<Box<dyn Future<Output = async_graphql::Result<Option<T>>> + Send + 'ctx>>;

/// Supplies the canonical email-thread GraphQL object returned after a mutation.
///
/// The complete schema implements this boundary with its Soup email-thread type,
/// keeping `graphql_email` independent from the higher-level schema composition.
pub trait EmailThreadMutationOutput: Send + Sync + 'static {
    /// Canonical email-thread output object.
    type Thread: OutputType + Send + Sync + 'static;

    /// Reload the mutated thread for the authenticated viewer.
    fn load_email_thread<'ctx>(
        ctx: &'ctx Context<'_>,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> EmailThreadMutationLoadFuture<'ctx, Self::Thread>;
}

/// Root GraphQL adapter for email mutations.
pub struct GraphqlEmailMutation<S, O>(PhantomData<fn() -> (S, O)>);

impl<S, O> GraphqlEmailMutation<S, O> {
    /// Construct an email mutation root.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<S, O> Default for GraphqlEmailMutation<S, O> {
    fn default() -> Self {
        Self::new()
    }
}

/// Input for marking an email thread as seen.
#[derive(InputObject)]
pub struct MarkEmailThreadSeenInput {
    /// Email thread to mark as seen.
    pub thread_id: ID,
}

/// Input for adding or removing a label from an email thread.
#[derive(InputObject)]
pub struct UpdateEmailThreadLabelInput {
    /// Email thread whose label assignment will change.
    pub thread_id: ID,
    /// Label to add or remove.
    pub label_id: ID,
    /// Whether the label should be present after the mutation.
    pub value: bool,
}

fn mutation_error(error: &EmailErr) -> async_graphql::Error {
    let message = match error {
        EmailErr::ThreadNotFound | EmailErr::ThreadEmpty => "email thread not found",
        EmailErr::LabelNotFound => "email label not found",
        EmailErr::EmptyProviderLabelId => "email label is invalid",
        EmailErr::Unauthorized => "not authorized to update email thread",
        _ => "email thread mutation failed",
    };
    async_graphql::Error::new(message)
}

async fn reload_thread<O: EmailThreadMutationOutput>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    thread_id: Uuid,
) -> async_graphql::Result<O::Thread> {
    O::load_email_thread(ctx, user_id, thread_id)
        .await?
        .ok_or_else(|| async_graphql::Error::new("updated email thread is unavailable"))
}

/// GraphQL email mutations.
#[Object]
impl<S, O> GraphqlEmailMutation<S, O>
where
    S: EmailMutationService,
    O: EmailThreadMutationOutput,
{
    /// Mark an accessible email thread as seen and return its authoritative cache record.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn mark_email_thread_seen(
        &self,
        ctx: &Context<'_>,
        input: MarkEmailThreadSeenInput,
    ) -> async_graphql::Result<O::Thread> {
        let user_id = require_authenticated_user(ctx)?;
        let thread_id = parse_id(input.thread_id, "threadId")?;
        let service = ctx.data::<Arc<S>>()?;

        service
            .mark_email_thread_seen(user_id.clone(), thread_id)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    %thread_id,
                    "failed to mark email thread seen"
                );
                mutation_error(&error)
            })?;

        reload_thread::<O>(ctx, user_id, thread_id).await
    }

    /// Add or remove one label from an accessible email thread and return its authoritative cache record.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn update_email_thread_label(
        &self,
        ctx: &Context<'_>,
        input: UpdateEmailThreadLabelInput,
    ) -> async_graphql::Result<O::Thread> {
        let user_id = require_authenticated_user(ctx)?;
        let thread_id = parse_id(input.thread_id, "threadId")?;
        let label_id = parse_id(input.label_id, "labelId")?;
        let service = ctx.data::<Arc<S>>()?;

        service
            .update_email_thread_label(user_id.clone(), thread_id, label_id, input.value)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    %thread_id,
                    %label_id,
                    value = input.value,
                    "failed to update email thread label"
                );
                mutation_error(&error)
            })?;

        reload_thread::<O>(ctx, user_id, thread_id).await
    }
}
