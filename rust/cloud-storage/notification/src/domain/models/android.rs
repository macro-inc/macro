use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FCMMessage<T> {
    pub(crate) android: AndroidData,
    data: T,
}

impl<T> FCMMessage<T> {
    /// temporary method since android is currently out of scope for mobile
    /// this just instantiates a majority blank notif
    pub fn new_temporary_empty(data: T) -> Self {
        FCMMessage {
            android: AndroidData {
                notification: "Temporary placeholder".to_string(),
                priority: AndroidNotifPrio::Normal,
                collapse_key: String::new(),
            },
            data,
        }
    }
}

#[derive(Debug, Serialize)]
pub enum AndroidNotifPrio {
    Normal,
    #[expect(dead_code)]
    High,
}

#[derive(Debug, Serialize)]
pub struct AndroidData {
    pub(crate) notification: String,
    pub(crate) priority: AndroidNotifPrio,
    pub(crate) collapse_key: String,
}
