//! A mailbox's People API contacts, with sync tokens.

use serde_json::{Value, json};

use crate::error::ApiError;
use crate::seed::SeedContact;

const SYNC_TOKEN_PREFIX: &str = "sync-";

#[derive(Clone, Debug)]
struct Person {
    resource_name: String,
    contact: SeedContact,
    deleted: bool,
    /// The book version that last changed this person.
    changed_at: u64,
}

/// One page of a contact listing.
pub(crate) struct PeoplePage {
    pub(crate) people: Vec<Value>,
    pub(crate) next_page_token: Option<String>,
    /// Present on the last page, when the request asked for one.
    pub(crate) next_sync_token: Option<String>,
}

/// Contacts or other contacts. A sync token names a version of the book;
/// listing with one returns what changed since.
#[derive(Debug)]
pub(crate) struct ContactBook {
    resource_prefix: &'static str,
    people: Vec<Person>,
    version: u64,
    /// Sync tokens from before this version answer `EXPIRED_SYNC_TOKEN`.
    oldest_valid_version: u64,
}

impl ContactBook {
    pub(crate) fn new(resource_prefix: &'static str, contacts: &[SeedContact]) -> Self {
        let mut book = Self {
            resource_prefix,
            people: Vec::new(),
            version: 1,
            oldest_valid_version: 1,
        };
        for contact in contacts {
            book.upsert(contact.clone());
        }
        book
    }

    /// Adds a contact, or changes the one with the same address.
    pub(crate) fn upsert(&mut self, contact: SeedContact) {
        self.version += 1;
        let existing = self
            .people
            .iter_mut()
            .find(|person| person.contact.email.eq_ignore_ascii_case(&contact.email));

        match existing {
            Some(person) => {
                person.contact = contact;
                person.deleted = false;
                person.changed_at = self.version;
            }
            None => self.people.push(Person {
                resource_name: format!("{}{}", self.resource_prefix, self.people.len() + 1),
                contact,
                deleted: false,
                changed_at: self.version,
            }),
        }
    }

    /// Deletes the contact with this address. Returns whether there was one.
    pub(crate) fn remove(&mut self, email: &str) -> bool {
        self.version += 1;
        let version = self.version;
        let person = self
            .people
            .iter_mut()
            .find(|person| !person.deleted && person.contact.email.eq_ignore_ascii_case(email));

        match person {
            Some(person) => {
                person.deleted = true;
                person.changed_at = version;
                true
            }
            None => false,
        }
    }

    /// Makes every sync token handed out so far expired.
    pub(crate) fn expire_sync_tokens(&mut self) {
        self.version += 1;
        self.oldest_valid_version = self.version;
    }

    /// One page of people: all of them, or with a sync token those changed
    /// since.
    pub(crate) fn list(
        &self,
        sync_token: Option<&str>,
        request_sync_token: bool,
        page_size: usize,
        offset: usize,
    ) -> Result<PeoplePage, ApiError> {
        let since = match sync_token {
            None => None,
            Some(token) => Some(self.sync_token_version(token)?),
        };
        let matching: Vec<&Person> = self
            .people
            .iter()
            .filter(|person| match since {
                Some(version) => person.changed_at > version,
                None => !person.deleted,
            })
            .collect();

        let people = matching
            .iter()
            .skip(offset)
            .take(page_size)
            .map(|person| person_json(&person.resource_name, &person.contact, person.deleted))
            .collect();
        let has_more = offset + page_size < matching.len();

        Ok(PeoplePage {
            people,
            next_page_token: has_more.then(|| (offset + page_size).to_string()),
            next_sync_token: (!has_more && request_sync_token)
                .then(|| format!("{SYNC_TOKEN_PREFIX}{}", self.version)),
        })
    }

    fn sync_token_version(&self, token: &str) -> Result<u64, ApiError> {
        let version = token
            .strip_prefix(SYNC_TOKEN_PREFIX)
            .and_then(|version| version.parse::<u64>().ok())
            .ok_or_else(|| ApiError::invalid_argument("Sync token is invalid."))?;
        if version < self.oldest_valid_version {
            return Err(ApiError::failed_precondition(
                "Sync token is expired. Clear local cache and retry call without the sync token. \
                 [reason: \"EXPIRED_SYNC_TOKEN\"]",
            ));
        }
        Ok(version)
    }
}

/// A person as the People API's `Person` JSON.
pub(crate) fn person_json(resource_name: &str, contact: &SeedContact, deleted: bool) -> Value {
    if deleted {
        return json!({
            "resourceName": resource_name,
            "metadata": { "deleted": true },
        });
    }

    let mut person = json!({
        "resourceName": resource_name,
        "etag": format!("%{resource_name}"),
        "emailAddresses": [{ "value": contact.email }],
    });
    if let Some(name) = &contact.name {
        person["names"] = json!([{ "displayName": name }]);
    }
    if let Some(url) = &contact.photo_url {
        person["photos"] = json!([{ "url": url, "default": false }]);
    }
    person
}
