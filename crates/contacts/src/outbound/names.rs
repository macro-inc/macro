use crate::domain::{
    models::{contact::ContactName, page::MAX_CONTACT_PAGE_SIZE},
    ports::ContactNameReader,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use non_empty::NonEmpty;
use rootcause::{Report, prelude::*};
use sqlx::PgPool;
use std::ops::Deref;

/// Reuses the user-name owner's existing profile/address-book precedence query.
pub struct DbContactNames {
    db: PgPool,
}

impl DbContactNames {
    /// Read names using the same pool/snapshot source as directory membership.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl ContactNameReader for DbContactNames {
    #[tracing::instrument(name = "contacts.names.read", skip_all, fields(contact_count = contacts.len()), err)]
    async fn contact_names(
        &self,
        viewer: MacroUserIdStr<'_>,
        contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<ContactName>, Report> {
        if contacts.len() > usize::from(MAX_CONTACT_PAGE_SIZE) {
            return Err(rootcause::report!("contact name batch exceeded its bound"));
        }
        let Ok(ids) = NonEmpty::new(
            contacts
                .iter()
                .map(|id| id.deref().copied())
                .collect::<Vec<_>>(),
        ) else {
            return Ok(Vec::new());
        };
        let names = macro_db_client::user::get_user_name::get_user_names_with_email(
            &self.db,
            viewer.as_ref(),
            ids,
        )
        .await
        .into_rootcause()?;
        Ok(names
            .into_iter()
            .filter_map(|name| {
                Some(ContactName {
                    user_id: MacroUserIdStr::try_from(name.id).ok()?,
                    first_name: name.first_name,
                    last_name: name.last_name,
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
