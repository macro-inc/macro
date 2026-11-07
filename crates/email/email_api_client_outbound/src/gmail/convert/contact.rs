use models_email::gmail::contacts::PersonResource;
use models_email::service::contact::Contact;
use uuid::Uuid;

pub(crate) fn map_person_to_contact(link_id: Uuid, person: PersonResource) -> Contact {
    let name = person.names.into_iter().find_map(|name| name.display_name);
    let email_address = person
        .email_addresses
        .into_iter()
        .find_map(|email| email.value);
    let original_photo_url = person
        .photos
        .into_iter()
        .find(|photo| photo.url.is_some() && photo.default != Some(true))
        .and_then(|photo| photo.url)
        .map(normalize_google_photo_url);

    Contact {
        id: Uuid::now_v7(),
        link_id,
        name,
        email_address,
        original_photo_url,
        sfs_photo_url: None,
    }
}

fn normalize_google_photo_url(photo_url: String) -> String {
    match photo_url.strip_suffix("s100") {
        Some(prefix) => format!("{prefix}s128"),
        None => photo_url,
    }
}

#[cfg(test)]
mod test;
