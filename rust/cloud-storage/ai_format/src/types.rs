// this is a good pattern that we are not yet ready for
// use crate::traits::AiFormat;

// pub struct DocumentFormat {
//     pub content: String,
//     pub id: String,
//     pub name: String,
//     pub file_type: String,
// }

// impl AiFormat for DocumentFormat {
//     fn ai_format(self) -> impl std::fmt::Display {
//         format!(
//             "<document name={} id={} file_type={}>\n{}\n</document>",
//             self.name, self.id, self.file_type, self.content
//         )
//     }
// }
