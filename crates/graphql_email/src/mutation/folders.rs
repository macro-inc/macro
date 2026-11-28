use std::{collections::HashSet, marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ID, InputObject, Object};
use email::domain::models::mailbox_action::MailboxAction;
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{EmailMutationService, EmailThreadMutationOutput, mutation_error, reload_thread};

const MAX_FOLDER_THREADS: usize = 32;

/// Provider-neutral folders whose membership can change.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
pub enum EmailThreadFolderField {
    /// Spam or junk.
    Junk,
    /// Trash or deleted items.
    Trashed,
}

/// Change folder membership for up to 32 independent email threads.
#[derive(InputObject)]
pub struct SetEmailThreadFolderStatesInput {
    /// Canonical thread IDs in the batch.
    thread_ids: Vec<ID>,
    /// Folder to move into or out of.
    field: EmailThreadFolderField,
    /// Whether the threads should be in the folder.
    value: bool,
}

/// One thread's write acknowledgement with a separately resolved Mail row.
pub struct EmailThreadFolderOutcome<O: EmailThreadMutationOutput> {
    thread_id: Uuid,
    user_id: MacroUserIdStr<'static>,
    error: Option<String>,
    output: PhantomData<fn() -> O>,
}

/// One thread's write acknowledgement with a separately resolved Mail row.
#[Object]
impl<O: EmailThreadMutationOutput> EmailThreadFolderOutcome<O> {
    /// Canonical identity the write was applied to or rejected for.
    async fn thread_id(&self) -> ID {
        ID(self.thread_id.to_string())
    }

    /// Write failure, independent of errors in the returned row.
    async fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Load the committed thread from the primary. Projection errors can null
    /// this field while leaving the write acknowledgement available.
    async fn effect(&self, ctx: &Context<'_>) -> Option<O::Thread> {
        if self.error.is_some() {
            return None;
        }
        match reload_thread::<O>(ctx, self.user_id.clone(), self.thread_id).await {
            Ok(thread) => Some(thread),
            Err(error) => {
                ctx.add_error(ctx.set_error_path(error.into_server_error(ctx.item.pos)));
                None
            }
        }
    }
}

pub(super) async fn set_folder_states<S: EmailMutationService, O: EmailThreadMutationOutput>(
    ctx: &Context<'_>,
    input: SetEmailThreadFolderStatesInput,
) -> async_graphql::Result<Vec<EmailThreadFolderOutcome<O>>> {
    let user_id = require_authenticated_user(ctx)?;
    if input.thread_ids.is_empty() || input.thread_ids.len() > MAX_FOLDER_THREADS {
        return Err(async_graphql::Error::new(
            "expected between 1 and 32 email threads",
        ));
    }
    let thread_ids = input
        .thread_ids
        .into_iter()
        .map(|id| parse_id(id, "threadIds"))
        .collect::<async_graphql::Result<Vec<_>>>()?;
    let action = match input.field {
        EmailThreadFolderField::Junk => MailboxAction::Junk(input.value),
        EmailThreadFolderField::Trashed => MailboxAction::Trashed(input.value),
    };
    let service = ctx.data::<Arc<S>>()?;
    let mut outcomes = Vec::with_capacity(thread_ids.len());
    let mut processed = HashSet::new();
    let mut first_error = None;

    // Each domain call authorizes and writes one thread through its inbox.
    // Serial writes avoid competing for the same provider mailbox lock.
    for thread_id in thread_ids {
        if !processed.insert(thread_id) {
            continue;
        }
        let error = service
            .set_email_thread_state(user_id.clone(), thread_id, action.clone())
            .await
            .err()
            .map(|error| {
                let error = mutation_error(&error);
                let message = error.message.clone();
                first_error.get_or_insert(error);
                message
            });
        outcomes.push(EmailThreadFolderOutcome {
            thread_id,
            user_id: user_id.clone(),
            error,
            output: PhantomData,
        });
    }
    // With no commits, the ordinary queue rejection/retry rules still apply.
    if outcomes.iter().all(|outcome| outcome.error.is_some())
        && let Some(error) = first_error
    {
        return Err(error);
    }

    Ok(outcomes)
}
