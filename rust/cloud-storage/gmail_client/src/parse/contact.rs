use models_email::gmail::contacts::PersonResource;
use models_email::service::contact::Contact;
use uuid::Uuid;

pub fn map_person_to_contact(link_id: Uuid, person: PersonResource) -> Contact {
    let display_name = person
        .names
        .into_iter()
        .find(|n| n.display_name.is_some())
        .and_then(|n| n.display_name);

    let email_address = person
        .email_addresses
        .into_iter()
        .find(|e| e.value.is_some())
        .and_then(|e| e.value);

    // return first photo that isn't a default photo
    let original_photo_url = person
        .photos
        .into_iter()
        .find(|p| p.url.is_some() && p.default.is_none_or(|d| !d))
        .and_then(|p| p.url);

    Contact {
        id: None,
        link_id,
        name: display_name,
        email_address,
        original_photo_url,
        sfs_photo_url: None,
    }
}
