use anyhow::Result;
use aws_sdk_s3 as s3;

/// Gets all the keys in a folder
/// Returns a list of the (file_name, file_type) for each file in the folder
#[tracing::instrument(skip(client))]
pub async fn get_folder_content_names(
    client: &s3::Client,
    bucket: &str,
    folder_path: &str,
) -> Result<Vec<(String, String)>> {
    let normalized_path = if folder_path.ends_with('/') {
        folder_path.to_string()
    } else {
        format!("{}/", folder_path)
    };

    let obj_list = client
        .list_objects_v2()
        .bucket(bucket.to_owned())
        .prefix(normalized_path.clone())
        .send()
        .await?;

    let item_keys: Vec<String> = obj_list
        .contents()
        .iter()
        .filter_map(|obj| obj.key())
        // Filter out the folder itself and any nested folders
        .filter(|key| key.starts_with(&normalized_path) && key != &normalized_path)
        .map(String::from)
        .collect();

    Ok(item_keys
        .into_iter()
        .map(|key| {
            // Remove the folder prefix to get just the filename
            let filename = key[normalized_path.len()..].to_string();
            let parts: Vec<&str> = filename.split('.').collect();

            if parts.len() > 1 {
                (parts[0].to_string(), parts.last().unwrap().to_string())
            } else {
                (filename, String::new())
            }
        })
        .collect())
}
