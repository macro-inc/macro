// its jover
// ai generated types :)
use serde::Deserialize;

#[derive(Deserialize, Debug, PartialEq)]
pub struct S3EventNotification {
    #[serde(rename = "Records")]
    pub records: Vec<S3EventRecord>,
}

#[derive(Deserialize, Debug, PartialEq)]
pub enum S3EventKind {
    TestEvent,
    #[serde(rename = "ObjectCreated:*")]
    ObjectCreatedAll,
    #[serde(rename = "ObjectCreated:Put")]
    ObjectCreatedPut,
    #[serde(rename = "ObjectCreated:Post")]
    ObjectCreatedPost,
    #[serde(rename = "ObjectCreated:Copy")]
    ObjectCreatedCopy,
    #[serde(rename = "ObjectCreated:CompleteMultipartUpload")]
    ObjectCreatedCompleteMultipartUpload,
    #[serde(rename = "ObjectRemoved:*")]
    ObjectRemovedAll,
    #[serde(rename = "ObjectRemoved:Delete")]
    ObjectRemovedDelete,
    #[serde(rename = "ObjectRemoved:DeleteMarkerCreated")]
    ObjectRemovedDeleteMarkerCreated,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct S3EventRecord {
    #[serde(rename = "eventVersion")]
    pub event_version: String,
    #[serde(rename = "eventSource")]
    pub event_source: String,
    #[serde(rename = "awsRegion")]
    pub aws_region: String,
    #[serde(rename = "eventTime")]
    pub event_time: String,
    #[serde(rename = "eventName")]
    pub event_kind: S3EventKind,
    #[serde(rename = "userIdentity")]
    pub user_identity: UserIdentity,
    #[serde(rename = "requestParameters")]
    pub request_parameters: RequestParameters,
    #[serde(rename = "responseElements")]
    pub response_elements: ResponseElements,
    pub s3: S3Entity,
    #[serde(rename = "glacierEventData", default)]
    pub glacier_event_data: Option<GlacierEventData>,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct UserIdentity {
    #[serde(rename = "principalId")]
    pub principal_id: String,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct RequestParameters {
    #[serde(rename = "sourceIPAddress")]
    pub source_ip_address: String,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct ResponseElements {
    #[serde(rename = "x-amz-request-id")]
    pub request_id: String,
    #[serde(rename = "x-amz-id-2")]
    pub id_2: String,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct S3Entity {
    #[serde(rename = "s3SchemaVersion")]
    pub schema_version: String,
    #[serde(rename = "configurationId")]
    pub configuration_id: String,
    pub bucket: S3Bucket,
    pub object: S3Object,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct S3Bucket {
    pub name: String,
    #[serde(rename = "ownerIdentity")]
    pub owner_identity: UserIdentity,
    pub arn: String,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct S3Object {
    pub key: String,
    pub size: usize,
    #[serde(rename = "eTag")]
    pub etag: String,
    #[serde(rename = "versionId")]
    pub version_id: Option<String>,
    pub sequencer: String,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct GlacierEventData {
    #[serde(rename = "restoreEventData")]
    pub restore_event_data: RestoreEventData,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct RestoreEventData {
    #[serde(rename = "lifecycleRestorationExpiryTime")]
    pub lifecycle_restoration_expiry_time: String,
    #[serde(rename = "lifecycleRestoreStorageClass")]
    pub lifecycle_restore_storage_class: String,
}

#[cfg(test)]
mod tests {

    use crate::api::event::message::{
        RequestParameters, ResponseElements, S3Bucket, S3Entity, S3EventNotification,
    };

    use super::{S3EventKind, S3EventRecord, S3Object, UserIdentity};
    #[test]
    fn test_deserialize_put() {
        let body = r#""{\"Records\":[{\"eventVersion\":\"2.1\",\"eventSource\":\"aws:s3\",\"awsRegion\":\"us-east-1\",\"eventTime\":\"2025-01-30T20:41:13.232Z\",\"eventName\":\"ObjectCreated:Put\",\"userIdentity\":{\"principalId\":\"AWS:AIDAYI7JX6QVI33ZYM5PI\"},\"requestParameters\":{\"sourceIPAddress\":\"216.158.154.52\"},\"responseElements\":{\"x-amz-request-id\":\"XYY0TTJ8N6ETBVPN\",\"x-amz-id-2\":\"pM4egwak7pbHSf4nURDbFCR6bl+QMKZ1SB82wl+gvQRqofOwoTaTnhm3a1B+T/tQX8OXQTHd8lvNeOHo1su4FaKxCUVcqhtH\"},\"s3\":{\"s3SchemaVersion\":\"1.0\",\"configurationId\":\"pu-s3-queue-20250130170927591700000001\",\"bucket\":{\"name\":\"static-files-dev\",\"ownerIdentity\":{\"principalId\":\"A2KQHNRTKU5GOK\"},\"arn\":\"arn:aws:s3:::static-files-dev\"},\"object\":{\"key\":\"9c1d3a03-639e-4cc7-8a3a-681b19e70a64\",\"size\":84434,\"eTag\":\"a2587d3fce66d6bd412eebd2392bf2c0\",\"sequencer\":\"00679BE3E933D4A4EA\"}}}]}""#;
        let expected = S3EventNotification {
            records: vec![
                S3EventRecord {
                    event_version: "2.1".to_string(),
                    event_source: "aws:s3".to_string(),
                    aws_region: "us-east-1".to_string(),
                    event_time: "2025-01-30T20:41:13.232Z".to_string(),
                    event_kind: S3EventKind::ObjectCreatedPut,
                    user_identity: UserIdentity {
                        principal_id: "AWS:AIDAYI7JX6QVI33ZYM5PI".to_string(),
                    },
                    request_parameters: RequestParameters {
                        source_ip_address: "216.158.154.52".to_string(),
                    },
                    response_elements: ResponseElements {
                        request_id: "XYY0TTJ8N6ETBVPN".to_string(),
                        id_2: "pM4egwak7pbHSf4nURDbFCR6bl+QMKZ1SB82wl+gvQRqofOwoTaTnhm3a1B+T/tQX8OXQTHd8lvNeOHo1su4FaKxCUVcqhtH".to_string(),
                    },
                    s3: S3Entity {
                        schema_version: "1.0".to_string(),
                        configuration_id: "pu-s3-queue-20250130170927591700000001".to_string(),
                        bucket: S3Bucket {
                            name: "static-files-dev".to_string(),
                            owner_identity: UserIdentity {
                                principal_id: "A2KQHNRTKU5GOK".to_string(),
                            },
                            arn: "arn:aws:s3:::static-files-dev".to_string(),
                        },
                        object: S3Object {
                            key: "9c1d3a03-639e-4cc7-8a3a-681b19e70a64".to_string(),
                            size: 84434 ,
                            etag: "a2587d3fce66d6bd412eebd2392bf2c0".to_string(),
                            version_id: None,
                            sequencer: "00679BE3E933D4A4EA".to_string(),
                        },
                    },
                    glacier_event_data: None,
                }
            ]
        };

        let cleaned: String = serde_json::from_str(body).unwrap();
        let deserialized = serde_json::from_str::<S3EventNotification>(cleaned.as_str());
        println!("{:?}", deserialized);
        assert!(deserialized.is_ok());
        let deserialized = deserialized.unwrap();
        assert_eq!(deserialized, expected);
        println!("{:?}", deserialized);
    }
}
