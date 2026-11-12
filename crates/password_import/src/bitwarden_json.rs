//! Bitwarden unencrypted JSON: `{ encrypted, folders, items }`.
use std::collections::HashMap;

use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::value::RawValue;

use crate::draft::{self, Draft, Parts};
use crate::error::ImportError;
use crate::model::{DroppedPart, FolderPath, ItemKind, Limits, Secret, SkipReason, SourceKey};

#[derive(Deserialize)]
pub(crate) struct Envelope {
    pub(crate) encrypted: Option<bool>,
    pub(crate) items: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct Export<'a> {
    encrypted: Option<bool>,
    folders: Option<Vec<Folder>>,
    #[serde(borrow)]
    items: Option<Vec<&'a RawValue>>,
}

#[derive(Deserialize)]
struct Folder {
    id: Option<String>,
    name: Option<String>,
}

/// Item ids only, to name an item whose full shape didn't parse.
#[derive(Deserialize)]
struct ItemId {
    id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: Option<String>,
    organization_id: Option<String>,
    collection_ids: Option<Vec<IgnoredAny>>,
    folder_id: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<u8>,
    name: Option<String>,
    notes: Option<Secret>,
    favorite: Option<bool>,
    fields: Option<Vec<Field>>,
    login: Option<Login>,
    card: Option<Card>,
    identity: Option<Identity>,
    ssh_key: Option<SshKey>,
    password_history: Option<Vec<IgnoredAny>>,
    attachments: Option<Vec<IgnoredAny>>,
    deleted_date: Option<IgnoredAny>,
    archived_date: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct Field {
    name: Option<String>,
    value: Option<Secret>,
    #[serde(rename = "type")]
    field_type: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Login {
    uris: Option<Vec<Uri>>,
    username: Option<Secret>,
    password: Option<Secret>,
    totp: Option<Secret>,
    fido2_credentials: Option<Vec<IgnoredAny>>,
}

#[derive(Deserialize)]
struct Uri {
    uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Card {
    cardholder_name: Option<Secret>,
    brand: Option<Secret>,
    number: Option<Secret>,
    exp_month: Option<Secret>,
    exp_year: Option<Secret>,
    code: Option<Secret>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    title: Option<Secret>,
    first_name: Option<Secret>,
    middle_name: Option<Secret>,
    last_name: Option<Secret>,
    address1: Option<Secret>,
    address2: Option<Secret>,
    address3: Option<Secret>,
    city: Option<Secret>,
    state: Option<Secret>,
    postal_code: Option<Secret>,
    country: Option<Secret>,
    company: Option<Secret>,
    email: Option<Secret>,
    phone: Option<Secret>,
    ssn: Option<Secret>,
    username: Option<Secret>,
    passport_number: Option<Secret>,
    license_number: Option<Secret>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshKey {
    private_key: Option<Secret>,
    public_key: Option<Secret>,
    key_fingerprint: Option<Secret>,
}

const LOGIN: u8 = 1;
const SECURE_NOTE: u8 = 2;
const CARD: u8 = 3;
const IDENTITY: u8 = 4;
const SSH_KEY: u8 = 5;

const FIELD_HIDDEN: u8 = 1;
const FIELD_LINKED: u8 = 3;

pub(crate) fn parse(bytes: &[u8], limits: &Limits) -> Result<Parts, ImportError> {
    let export: Export<'_> =
        serde_json::from_slice(bytes).map_err(|error| ImportError::json(&error))?;
    if export.encrypted == Some(true) {
        return Err(ImportError::EncryptedBitwarden);
    }

    let items = export.items.ok_or(ImportError::UnsupportedVersion)?;
    if items.len() > limits.max_items {
        return Err(ImportError::TooManyItems);
    }

    let folders: HashMap<String, String> = export
        .folders
        .unwrap_or_default()
        .into_iter()
        .filter_map(|folder| Some((folder.id?, folder.name?)))
        .collect();

    let mut parts = Parts::default();
    for (index, raw) in items.iter().enumerate() {
        match serde_json::from_str::<Item>(raw.get()) {
            Ok(item) => add_item(&mut parts, item, index, &folders),
            Err(_) => {
                let key = serde_json::from_str::<ItemId>(raw.get())
                    .ok()
                    .and_then(|item| item.id)
                    .and_then(|id| SourceKey::from_source_id(&id))
                    .unwrap_or_else(|| SourceKey::from_item_index(index));
                parts.skip(Some(key), None, SkipReason::Malformed);
            }
        }
    }

    Ok(parts)
}

fn add_item(parts: &mut Parts, item: Item, index: usize, folders: &HashMap<String, String>) {
    let key = item
        .id
        .as_deref()
        .and_then(SourceKey::from_source_id)
        .unwrap_or_else(|| SourceKey::from_item_index(index));
    let name = item.name.as_deref();

    if item.deleted_date.is_some() {
        return parts.skip(Some(key), name, SkipReason::Trashed);
    }
    if item.archived_date.is_some() {
        return parts.skip(Some(key), name, SkipReason::Archived);
    }

    let in_collection = item
        .collection_ids
        .as_ref()
        .is_some_and(|collections| !collections.is_empty());
    if item.organization_id.is_some() || in_collection {
        return parts.skip(Some(key), name, SkipReason::SharedCollection);
    }

    let kind = match item.item_type {
        Some(LOGIN) => ItemKind::Login,
        Some(SECURE_NOTE) => ItemKind::Note,
        Some(CARD) => ItemKind::Card,
        Some(IDENTITY) => ItemKind::Identity,
        Some(SSH_KEY) => ItemKind::Api,
        _ => return parts.skip(Some(key), name, SkipReason::UnsupportedCategory),
    };

    let mut draft = Draft::new(key, kind);
    draft.set_name(item.name);
    draft.set_favorite(item.favorite == Some(true));
    if let Some(folder) = item.folder_id.and_then(|id| folders.get(&id)) {
        // Bitwarden nests folders by name: `Work/Clients`.
        draft.set_folder(FolderPath::new(folder.split('/')));
    }
    if let Some(notes) = item.notes {
        draft.notes(notes);
    }

    match kind {
        ItemKind::Login => {
            if let Some(login) = item.login {
                add_login(&mut draft, login);
            }
        }
        ItemKind::Card => {
            if let Some(card) = item.card {
                add_card(&mut draft, card);
            }
        }
        ItemKind::Identity => {
            if let Some(identity) = item.identity {
                add_identity(&mut draft, identity);
            }
        }
        ItemKind::Api => {
            if let Some(key) = item.ssh_key {
                add_ssh_key(&mut draft, key);
            }
        }
        ItemKind::Note | ItemKind::VerificationCode => {}
    }

    for field in item.fields.unwrap_or_default() {
        if field.field_type == Some(FIELD_LINKED) {
            draft.drop_part(DroppedPart::ExtraField, 1);
            continue;
        }

        let label = field.name.as_deref().unwrap_or_default();
        let concealed = field.field_type == Some(FIELD_HIDDEN);
        draft.field(label, field.value.unwrap_or_default(), concealed);
    }

    let history = item.password_history.map_or(0, |history| history.len());
    draft.drop_part(DroppedPart::PasswordHistory, history);
    let attachments = item.attachments.map_or(0, |attachments| attachments.len());
    draft.drop_part(DroppedPart::Attachment, attachments);

    parts.add(draft);
}

fn add_login(draft: &mut Draft, login: Login) {
    for uri in login.uris.unwrap_or_default() {
        if let Some(uri) = uri.uri {
            draft.add_url(&uri);
        }
    }

    if let Some(username) = login.username {
        draft.username(username, "Username");
    }
    if let Some(password) = login.password {
        draft.password(password, "Password");
    }
    if let Some(totp) = login.totp {
        draft.one_time_password(totp);
    }

    let passkeys = login.fido2_credentials.map_or(0, |passkeys| passkeys.len());
    draft.drop_part(DroppedPart::Passkey, passkeys);
}

fn add_card(draft: &mut Draft, card: Card) {
    if let Some(cardholder) = card.cardholder_name {
        draft.username(cardholder, "Cardholder name");
    }
    if let Some(number) = card.number {
        draft.password(number, "Number");
    }

    let month = card.exp_month.unwrap_or_default();
    let year = card.exp_year.unwrap_or_default();
    // `MM/YYYY`, matching 1Password's expiry.
    let month = if month.len() == 1 {
        Secret::join(["0", month.expose_secret()], "")
    } else {
        month
    };
    let expires = Secret::join([month.expose_secret(), year.expose_secret()], "/");
    draft.field(draft::EXPIRES, expires, false);

    if let Some(code) = card.code {
        draft.field(draft::SECURITY_CODE, code, true);
    }
    if let Some(brand) = card.brand {
        draft.field("Brand", brand, false);
    }
}

fn add_identity(draft: &mut Draft, identity: Identity) {
    let full_name = Secret::join(
        [
            &identity.first_name,
            &identity.middle_name,
            &identity.last_name,
        ]
        .into_iter()
        .flatten()
        .map(Secret::expose_secret),
        " ",
    );
    draft.username(full_name, "Name");

    if let Some(email) = identity.email {
        draft.field(draft::EMAIL, email, false);
    }
    if let Some(phone) = identity.phone {
        draft.field(draft::PHONE, phone, false);
    }

    let address = [
        &identity.address1,
        &identity.address2,
        &identity.address3,
        &identity.city,
        &identity.state,
        &identity.postal_code,
        &identity.country,
    ];
    let address = Secret::join(
        address.into_iter().flatten().map(Secret::expose_secret),
        ", ",
    );
    draft.field(draft::ADDRESS, address, false);

    let rest = [
        ("Title", identity.title, false),
        ("Company", identity.company, false),
        ("Username", identity.username, false),
        ("Social security number", identity.ssn, true),
        ("Passport number", identity.passport_number, true),
        ("License number", identity.license_number, true),
    ];
    for (label, value, concealed) in rest {
        if let Some(value) = value {
            draft.field(label, value, concealed);
        }
    }
}

fn add_ssh_key(draft: &mut Draft, key: SshKey) {
    if let Some(private_key) = key.private_key {
        draft.password(private_key, "Private key");
    }
    if let Some(public_key) = key.public_key {
        draft.username(public_key, "Public key");
    }
    if let Some(fingerprint) = key.key_fingerprint {
        draft.field("Fingerprint", fingerprint, false);
    }
}
