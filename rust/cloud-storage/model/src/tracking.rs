#[derive(serde::Serialize, serde::Deserialize, Clone, Eq, PartialEq, Debug)]
pub struct IPContext {
    /// The client ip address
    pub client_ip: String,
}
