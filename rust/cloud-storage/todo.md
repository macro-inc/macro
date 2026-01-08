I need you to update AI attachment fetching logic to also fetch properties for any Md document.

Properties are KV pairs that can be loaded from the db using the @properties_db_client/src/entity_properties/get.rs::get_bulk_properties_values. 

Files are fetched in the @scribe client. The scribe client is written so that
different consumers can inject different dependencies to get different features. Any
consumer of the document feature should be forced to inject the properties db connection
so that properties can be fetched for docs. Property fetching should be added as
part of the document client, though you should create a helper file/function to cleanly
distinguish between

Formatting is defined in the ai_format/src/document crate. 
1. add a new file "properties"
2. defined xml formatting for a list of k:v properties enclosed in <properties> tags
3. add an Option<Properties> field to the Document that will
optionally format properties before the <content> tag

