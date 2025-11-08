use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsResponse {
    #[serde(default)]
    pub connections: Vec<PersonResource>,
    pub next_page_token: Option<String>,
    pub next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherContactsResponse {
    #[serde(default)]
    pub other_contacts: Vec<PersonResource>,
    pub next_page_token: Option<String>,
    pub next_sync_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonResource {
    #[serde(default)]
    pub names: Vec<Name>,
    #[serde(default)]
    pub email_addresses: Vec<EmailAddress>,
    #[serde(default)]
    pub photos: Vec<Photo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Name {
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmailAddress {
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Photo {
    pub url: Option<String>,
    pub default: Option<bool>,
}
