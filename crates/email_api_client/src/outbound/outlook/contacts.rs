use std::collections::{HashSet, VecDeque};

use serde::Deserialize;

use super::{OutlookApiClientRepository, transport::invalid_response, wire};
use crate::domain::{models::*, ports::MailboxAddressBookReader};

#[cfg(test)]
mod test;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Folder {
    id: String,
    parent_folder_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contact {
    id: String,
    display_name: Option<String>,
    #[serde(default)]
    email_addresses: Vec<wire::Address>,
    #[serde(rename = "@removed")]
    removed: Option<serde_json::Value>,
}

impl MailboxAddressBookReader for OutlookApiClientRepository {
    async fn contact_folders(
        &self,
        token: &AccessToken,
    ) -> Result<ContactFolderCatalog, EmailApiError> {
        // /me/contactFolders lists children of the default folder, not that
        // folder itself. Its ID can be learned from a child or a saved contact.
        let mut default_folder = None;
        let mut folders = Vec::new();
        let mut seen = HashSet::new();
        let mut visited_pages = HashSet::new();
        let mut queue = VecDeque::from([(self.endpoint(&["me", "contactFolders"])?, true)]);
        while let Some((url, root)) = queue.pop_front() {
            if !visited_pages.insert(url.as_str().to_owned()) {
                return Err(invalid_response("contactFolders pages repeat"));
            }
            let page: wire::Page<Folder> = self.get(token, url).await?;
            for folder in page.value {
                if root && let Some(parent) = folder.parent_folder_id {
                    default_folder = Some(ProviderId::new(parent)?);
                }
                let id = ProviderId::new(folder.id)?;
                if !seen.insert(id.clone()) {
                    continue;
                }
                queue.push_back((
                    self.endpoint(&["me", "contactFolders", id.as_str(), "childFolders"])?,
                    false,
                ));
                folders.push(id);
            }
            if let Some(next) = page.next {
                queue.push_back((self.continuation(&StreamToken::new(next))?, root));
            }
        }
        if default_folder.is_none() {
            let mut url = self.endpoint(&["me", "contacts"])?;
            url.query_pairs_mut()
                .append_pair("$top", "1")
                .append_pair("$select", "id,parentFolderId");
            let page: wire::Page<Folder> = self.get(token, url).await?;
            default_folder = page
                .value
                .into_iter()
                .find_map(|contact| contact.parent_folder_id)
                .map(ProviderId::new)
                .transpose()?;
        }
        if let Some(default) = &default_folder
            && seen.insert(default.clone())
        {
            folders.push(default.clone());
        }
        Ok(ContactFolderCatalog {
            folders,
            default_folder,
        })
    }

    async fn contact_changes(
        &self,
        token: &AccessToken,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<AddressBookPage, EmailApiError> {
        let url = match position {
            Some(position) => self.continuation(position)?,
            None => {
                let mut url =
                    self.endpoint(&["me", "contactFolders", folder.as_str(), "contacts", "delta"])?;
                url.query_pairs_mut()
                    .append_pair("$select", "id,displayName,emailAddresses");
                url
            }
        };
        let page: wire::Page<Contact> = self.get(token, url).await?;
        let position = match (page.next, page.delta) {
            (Some(next), None) => StreamPosition::Continue(StreamToken::new(next)),
            (None, Some(delta)) => StreamPosition::Checkpoint(StreamToken::new(delta)),
            _ => {
                return Err(invalid_response(
                    "contacts delta page lacks one of nextLink and deltaLink",
                ));
            }
        };
        let (StreamPosition::Continue(next) | StreamPosition::Checkpoint(next)) = &position;
        self.continuation(next)?;
        let mut contacts = Vec::new();
        let mut removed = Vec::new();
        for contact in page.value {
            let id = ProviderId::new(contact.id)?;
            if contact.removed.is_some() {
                removed.push(id);
            } else {
                let mut emails: Vec<_> = contact
                    .email_addresses
                    .into_iter()
                    .map(|address| address.address.trim().to_lowercase())
                    .filter(|address| {
                        !address.is_empty()
                            && address.len() < 310
                            && !address.chars().any(char::is_control)
                    })
                    .collect();
                emails.sort();
                emails.dedup();
                contacts.push(AddressBookContact {
                    id,
                    name: contact.display_name.filter(|name| !name.trim().is_empty()),
                    emails,
                });
            }
        }
        Ok(AddressBookPage {
            contacts,
            removed,
            position,
        })
    }

    async fn self_contact(&self, token: &AccessToken) -> Result<AddressBookContact, EmailApiError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Profile {
            id: String,
            display_name: Option<String>,
            mail: Option<String>,
        }
        let mut url = self.endpoint(&["me"])?;
        url.query_pairs_mut()
            .append_pair("$select", "id,displayName,mail");
        let profile: Profile = self.get(token, url).await?;
        Ok(AddressBookContact {
            id: ProviderId::new(profile.id)?,
            name: profile.display_name,
            emails: profile
                .mail
                .into_iter()
                .map(|email| email.trim().to_lowercase())
                .collect(),
        })
    }

    async fn contact_photo(
        &self,
        token: &AccessToken,
        contact: Option<(&ProviderId, &ProviderId)>,
    ) -> Result<Option<ContactPhoto>, EmailApiError> {
        let url = match contact {
            Some((folder, contact)) => self.endpoint(&[
                "me",
                "contactFolders",
                folder.as_str(),
                "contacts",
                contact.as_str(),
                "photo",
                "$value",
            ])?,
            None => self.endpoint(&["me", "photo", "$value"])?,
        };
        // Most contacts have no photo, which Graph answers with a 404.
        let Some(mut response) = self.optional_request(token, url).await? else {
            return Ok(None);
        };
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|header| header.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::to_owned)
            .ok_or_else(|| invalid_response("contact photo has no Content-Type"))?;
        if !matches!(
            content_type.as_str(),
            "image/jpeg" | "image/png" | "image/gif" | "image/webp"
        ) {
            return Err(invalid_response("contact photo is not an image"));
        }
        const MAX_PHOTO_SIZE: usize = 4 * 1024 * 1024;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_PHOTO_SIZE as u64)
        {
            return Err(invalid_response("contact photo is too large"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| invalid_response("contact photo was cut off"))?
        {
            if bytes.len() + chunk.len() > MAX_PHOTO_SIZE {
                return Err(invalid_response("contact photo is too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some(ContactPhoto {
            bytes,
            content_type,
        }))
    }
}
