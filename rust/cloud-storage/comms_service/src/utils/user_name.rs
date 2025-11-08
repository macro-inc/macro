use std::collections::HashMap;

use model::user::UserNames;

pub fn id_to_email(id: &str) -> String {
    id.replace("macro|", "")
}

/// removes the @<domain>.com part of the email
pub fn strip_email(email: &str) -> String {
    email.split('@').collect::<Vec<&str>>()[0].to_string()
}

pub fn id_to_name(id: &str) -> String {
    strip_email(&id_to_email(id))
}

pub fn id_to_display_name(id: &str, name_lookup: Option<&HashMap<String, String>>) -> String {
    match name_lookup {
        Some(lookup) => match lookup.get(id) {
            Some(name) => name.clone(),
            _ => id_to_name(id),
        },
        _ => id_to_name(id),
    }
}

pub fn generate_name_lookup(names: UserNames) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for name in &names.names {
        let mut firstlast = Vec::new();
        let first = &name.first_name;
        let last = &name.last_name;

        if first.is_none() && last.is_none() {
            continue;
        }

        if first.is_some() {
            let firstname = first.as_ref().unwrap();
            // HACK: temporarily ignore N/A string as a workaround for new users being
            // initalized as N/A.
            if firstname != "N/A" && !firstname.is_empty() {
                firstlast.push(firstname.clone());
            }
        }

        if last.is_some() {
            let lastname = last.as_ref().unwrap();
            // HACK: temporarily ignore N/A string as a workaround for new users being
            // initalized as N/A.
            if lastname != "N/A" && !lastname.is_empty() {
                firstlast.push(lastname.clone());
            }
        }

        // HACK: names can still be empty at this point because of N/A, so only add when
        // there's a name to add
        if !firstlast.is_empty() {
            map.insert(name.id.clone(), firstlast.join(" "));
        }
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_to_email() {
        assert_eq!(id_to_email("macro|123"), "123");
        assert_eq!(id_to_email("macro|123@macro.com"), "123@macro.com");
    }

    #[test]
    fn test_strip_email() {
        assert_eq!(strip_email("123@macro.com"), "123");
        assert_eq!(strip_email("123"), "123");
    }

    #[test]
    fn test_id_to_name() {
        assert_eq!(id_to_name("macro|123"), "123");
        assert_eq!(id_to_name("macro|123@macro.com"), "123");
    }
}
