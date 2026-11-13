//! The signed-in user and their contacts.

use serde_json::{Value, json};

use super::{Ctx, Handled, Reply};
use crate::error::GraphError;
use crate::render;

pub(crate) fn me(ctx: &mut Ctx<'_>) -> Handled {
    let query = ctx.query.clone();
    let context = ctx.context("users/$entity");
    let mut user = render::user(ctx.mailbox()?, &query)?;
    user["@odata.context"] = json!(context);
    Ok(Reply::Json(200, user))
}

pub(crate) fn my_photo(ctx: &mut Ctx<'_>) -> Handled {
    match ctx.mailbox()?.photo.clone() {
        Some((content_type, bytes)) => Ok(Reply::Bytes(content_type, bytes)),
        None => Err(GraphError::server(
            404,
            "ImageNotFound",
            "Exception of type 'Microsoft.Fast.Profile.Core.Exception.ImageNotFoundException' was thrown.",
        )),
    }
}

/// The contact folders under the default one, of which a mailbox here has
/// none: every contact is in the default folder.
pub(crate) fn contact_folders(ctx: &mut Ctx<'_>) -> Handled {
    Ok(ctx.collection("users('me')/contactFolders", Vec::new(), None))
}

pub(crate) fn contacts(ctx: &mut Ctx<'_>) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let values: Vec<Value> = mailbox
        .contacts
        .values()
        .map(|contact| render::contact(contact, mailbox, &query))
        .collect::<Result<_, _>>()?;
    let (page, next) = ctx.page(values);
    Ok(ctx.collection("users('me')/contacts", page, next))
}

/// The default folder's contact changes, in one page. The delta token is
/// the mailbox's sync generation and the sequence number it read up to.
pub(crate) fn contacts_delta(ctx: &mut Ctx<'_>, folder: &str) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    if folder != mailbox.contact_folder_id {
        return Err(GraphError::item_not_found());
    }
    let since = match &query.delta_token {
        None => 0,
        Some(token) => {
            let parsed = token.split_once('.').and_then(|(epoch, seq)| {
                Some((epoch.parse::<u64>().ok()?, seq.parse::<u64>().ok()?))
            });
            match parsed {
                Some((epoch, seq)) if epoch == mailbox.delta_epoch && seq <= mailbox.seq => seq,
                _ => return Err(GraphError::sync_state_not_found()),
            }
        }
    };

    let (changed, removed) = mailbox.contact_changes(since);
    let mut values = Vec::new();
    for contact in changed {
        values.push(render::contact(contact, mailbox, &query)?);
    }
    for id in removed {
        values.push(json!({"id": id, "@removed": {"reason": "deleted"}}));
    }
    let token = format!("{}.{}", mailbox.delta_epoch, mailbox.seq);
    let path = format!("me/contactFolders('{folder}')/contacts/delta");
    let link = ctx.link(&path, &[("$deltatoken".to_string(), token)]);
    Ok(Reply::Json(
        200,
        json!({
            "@odata.context": ctx.context("Collection(contact)"),
            "value": values,
            "@odata.deltaLink": link,
        }),
    ))
}
