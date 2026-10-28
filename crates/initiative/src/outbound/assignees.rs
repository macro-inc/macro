//! Adapter from property assignment commands to the initiative owning service.

use crate::domain::{
    assignees::InitiativeAssignees, models::InitiativeError, ports::InitiativeRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use properties::{EditReceipt, InitiativeAssigneeService, PropertiesErr};
use std::{future::Future, pin::Pin};

impl<R: InitiativeRepo> InitiativeAssigneeService for InitiativeAssignees<R> {
    fn grant_assignees<'a>(
        &'a self,
        access: &'a EditReceipt,
        users: Vec<MacroUserIdStr<'static>>,
    ) -> Pin<Box<dyn Future<Output = Result<(), PropertiesErr>> + Send + 'a>> {
        Box::pin(async move {
            self.grant(access, users)
                .await
                .map_err(|error| match error {
                    InitiativeError::Unauthorized => PropertiesErr::PermissionDenied,
                    InitiativeError::NotFound => PropertiesErr::NotFound,
                    InitiativeError::BadRequest(message) => PropertiesErr::Validation(message),
                    other => PropertiesErr::Repo(other.into()),
                })
        })
    }
}
