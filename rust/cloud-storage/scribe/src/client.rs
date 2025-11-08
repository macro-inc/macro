#[derive(Clone)]
pub struct ScribeClient<DocumentClient, ChannelClient, ChatClient, EmailClient, StaticFileClient> {
    pub document: DocumentClient,
    pub channel: ChannelClient,
    pub chat: ChatClient,
    pub email: EmailClient,
    pub static_file: StaticFileClient,
}

type NoClient = ();

impl Default for ScribeClient<NoClient, NoClient, NoClient, NoClient, NoClient> {
    fn default() -> Self {
        Self::new()
    }
}

impl ScribeClient<NoClient, NoClient, NoClient, NoClient, NoClient> {
    pub fn new() -> Self {
        ScribeClient {
            document: (),
            channel: (),
            chat: (),
            email: (),
            static_file: (),
        }
    }
}
