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
    let obj_list = client
        .list_objects_v2()
        .bucket(bucket.to_owned())
        .send()
        .await?;

    // Simply collect the keys into a Vec<String>
    let item_keys: Vec<String> = obj_list
        .contents()
        .iter()
        .filter_map(|obj| obj.key())
        .map(String::from)
        .collect();

    Ok(item_keys
        .into_iter()
        .map(|key| {
            let key = key.as_str().split('.').collect::<Vec<&str>>();
            (key[0].to_string(), key.last().unwrap().to_string())
        })
        .collect())
}
