//! Mail folders, master categories and inbox rules.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::messages::folder_not_found;
use super::{Ctx, Handled, Reply};
use crate::error::GraphError;
use crate::odata::Filter;
use crate::render;

const FOLDER_ENTITY: &str = "users('me')/mailFolders";

/// The child folders of the mailbox root, or of a folder.
pub(crate) fn list(ctx: &mut Ctx<'_>, parent: Option<&str>) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let parent = mailbox
        .folder(parent.unwrap_or("msgfolderroot"))
        .ok_or_else(folder_not_found)?;

    let mut values = Vec::new();
    for folder in mailbox.child_folders(&parent.id) {
        let wanted = match &query.filter {
            None => true,
            Some(Filter::Property { id, value }) => folder
                .properties
                .iter()
                .any(|(key, stored)| key.eq_ignore_ascii_case(id) && stored == value),
            Some(_) => {
                return Err(GraphError::bad_request(
                    "Invalid filter clause: the emulator filters folders only by an extended property.",
                ));
            }
        };
        if wanted {
            values.push(render::folder(folder, mailbox, &query));
        }
    }
    let (page, next) = ctx.page(values);
    Ok(ctx.collection(FOLDER_ENTITY, page, next))
}

pub(crate) fn get(ctx: &mut Ctx<'_>, folder: &str) -> Handled {
    let query = ctx.query.clone();
    let mailbox = ctx.mailbox()?;
    let folder = mailbox.folder(folder).ok_or_else(folder_not_found)?;
    Ok(Reply::Json(200, render::folder(folder, mailbox, &query)))
}

pub(crate) fn create(ctx: &mut Ctx<'_>, parent: Option<&str>) -> Handled {
    let body = ctx.json_body()?;
    let query = ctx.query.clone();
    let name = body["displayName"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| GraphError::bad_request("displayName is required."))?;
    let mut properties = BTreeMap::new();
    for property in body["singleValueExtendedProperties"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if let (Some(id), Some(value)) = (property["id"].as_str(), property["value"].as_str()) {
            properties.insert(id.to_string(), value.to_string());
        }
    }

    let mailbox = ctx.mailbox()?;
    let parent = mailbox
        .folder(parent.unwrap_or("msgfolderroot"))
        .map(|folder| folder.id.clone())
        .ok_or_else(folder_not_found)?;
    let folder = mailbox.create_folder(name, &parent, properties)?;
    Ok(Reply::Json(201, render::folder(&folder, mailbox, &query)))
}

pub(crate) fn categories(ctx: &mut Ctx<'_>) -> Handled {
    let values: Vec<Value> = ctx
        .mailbox()?
        .categories
        .iter()
        .map(render::category)
        .collect();
    Ok(ctx.collection("users('me')/outlook/masterCategories", values, None))
}

pub(crate) fn create_category(ctx: &mut Ctx<'_>) -> Handled {
    let body = ctx.json_body()?;
    let name = body["displayName"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| GraphError::bad_request("displayName is required."))?;
    let color = body["color"].as_str().unwrap_or("none");
    let mailbox = ctx.mailbox()?;
    if mailbox
        .categories
        .iter()
        .any(|category| category.name == name)
    {
        return Err(GraphError::conflict(
            "A category with the same display name already exists.",
        ));
    }
    let category = mailbox.add_category(name, color);
    Ok(Reply::Json(201, render::category(&category)))
}

pub(crate) fn delete_category(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let mailbox = ctx.mailbox()?;
    let before = mailbox.categories.len();
    mailbox.categories.retain(|category| category.id != id);
    match mailbox.categories.len() == before {
        true => Err(GraphError::item_not_found()),
        false => Ok(Reply::Empty(204)),
    }
}

pub(crate) fn rules(ctx: &mut Ctx<'_>) -> Handled {
    let values = ctx.mailbox()?.rules.clone();
    Ok(ctx.collection(
        "users('me')/mailFolders('inbox')/messageRules",
        values,
        None,
    ))
}

pub(crate) fn create_rule(ctx: &mut Ctx<'_>) -> Handled {
    let mut rule = ctx.json_body()?;
    if !rule.is_object() || rule["displayName"].as_str().is_none() {
        return Err(GraphError::bad_request("A rule needs a displayName."));
    }
    let mailbox = ctx.mailbox()?;
    rule["id"] = json!(mailbox.new_id("rule"));
    rule["hasError"] = json!(false);
    rule["isReadOnly"] = json!(false);
    if rule.get("isEnabled").is_none() {
        rule["isEnabled"] = json!(true);
    }
    if rule.get("conditions").is_none() {
        rule["conditions"] = Value::Null;
    }
    if rule.get("actions").is_none() {
        rule["actions"] = Value::Null;
    }
    mailbox.rules.push(rule.clone());
    Ok(Reply::Json(201, rule))
}

pub(crate) fn delete_rule(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let mailbox = ctx.mailbox()?;
    let before = mailbox.rules.len();
    mailbox.rules.retain(|rule| rule["id"] != id);
    match mailbox.rules.len() == before {
        true => Err(GraphError::item_not_found()),
        false => Ok(Reply::Empty(204)),
    }
}
