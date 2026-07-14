use models_email::db::contact::ContactPhotoless;

pub fn normalize_contact(contact: ContactPhotoless) -> ContactPhotoless {
    let normalized_name =
        email_utils::normalize_contact_name(&contact.email_address, contact.name.as_deref());

    ContactPhotoless {
        id: contact.id,
        link_id: contact.link_id,
        email_address: contact.email_address.to_lowercase(),
        name: normalized_name,
    }
}
