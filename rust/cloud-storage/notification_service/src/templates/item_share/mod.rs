use url::Url;

static ITEM_SHARE_TEMPLATE: &str = include_str!("./_item_share_template.html");

static ITEM_SHARE_SUBJECT: &str = "Macro {{ITEM_TYPE}} Share";

pub static DOCUMNET_ITEM_SHARE_ICON: &str =
    "https://coparse-release-artifact-storage-bucket.s3.amazonaws.com/item_share_icons/doc.png";

pub static CHAT_ITEM_SHARE_ICON: &str =
    "https://coparse-release-artifact-storage-bucket.s3.amazonaws.com/item_share_icons/chat.png";

pub static PROJECT_ITEM_SHARE_ICON: &str =
    "https://coparse-release-artifact-storage-bucket.s3.amazonaws.com/item_share_icons/folder.png";

fn get_item_share_icon(item_type: &str) -> &str {
    match item_type {
        "document" => DOCUMNET_ITEM_SHARE_ICON,
        "chat" => CHAT_ITEM_SHARE_ICON,
        "project" => PROJECT_ITEM_SHARE_ICON,
        _ => "",
    }
}

pub fn fill_item_share_template(
    item_url: &Url,
    item_owner: &str,
    item_name: &str,
    item_type: &str,
) -> (String, String) {
    let item_share_icon = get_item_share_icon(item_type);

    let first_letter_uppercase = item_type.chars().next().unwrap().to_uppercase().to_string();
    let item_type = format!("{}{}", first_letter_uppercase, &item_type[1..]);

    let subject = ITEM_SHARE_SUBJECT.replace("{{ITEM_TYPE}}", &item_type);

    let content = ITEM_SHARE_TEMPLATE
        .replace("{{ITEM_OWNER}}", item_owner)
        .replace("{{ITEM_NAME}}", item_name)
        .replace("{{ITEM_TYPE}}", &item_type)
        .replace("{{ITEM_SHARE_ICON_URL}}", item_share_icon)
        .replace("{{ITEM_URL}}", item_url.as_str());

    (content, subject)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_uppercase_first_letter() {
        let word = "document";
        let first_letter_uppercase = word.chars().next().unwrap().to_uppercase().to_string();
        assert_eq!(first_letter_uppercase, "D");

        let updated_word = format!("{}{}", first_letter_uppercase, &word[1..]);
        assert_eq!(updated_word, "Document");

        let word = "chat";
        let first_letter_uppercase = word.chars().next().unwrap().to_uppercase().to_string();
        assert_eq!(first_letter_uppercase, "C");

        let updated_word = format!("{}{}", first_letter_uppercase, &word[1..]);
        assert_eq!(updated_word, "Chat");
    }
}
