use models_email::gmail::contacts::{EmailAddress, Name, PersonResource, Photo};
use uuid::Uuid;

use super::map_person_to_contact;

#[test]
fn maps_first_available_fields_and_resizes_google_photo() {
    let link_id = Uuid::now_v7();
    let person = PersonResource {
        names: vec![
            Name { display_name: None },
            Name {
                display_name: Some("Ada".into()),
            },
        ],
        email_addresses: vec![EmailAddress {
            value: Some("ada@example.com".into()),
        }],
        photos: vec![
            Photo {
                url: Some("https://example.com/default=s100".into()),
                default: Some(true),
            },
            Photo {
                url: Some("https://example.com/photo=s100".into()),
                default: Some(false),
            },
        ],
    };

    let contact = map_person_to_contact(link_id, person);

    assert_eq!(contact.link_id, link_id);
    assert_eq!(contact.name.as_deref(), Some("Ada"));
    assert_eq!(contact.email_address.as_deref(), Some("ada@example.com"));
    assert_eq!(
        contact.original_photo_url.as_deref(),
        Some("https://example.com/photo=s128")
    );
}

#[test]
fn leaves_non_google_size_suffix_unchanged() {
    let person = PersonResource {
        names: vec![],
        email_addresses: vec![],
        photos: vec![Photo {
            url: Some("https://example.com/photo=s96".into()),
            default: None,
        }],
    };

    let contact = map_person_to_contact(Uuid::now_v7(), person);

    assert_eq!(
        contact.original_photo_url.as_deref(),
        Some("https://example.com/photo=s96")
    );
}
