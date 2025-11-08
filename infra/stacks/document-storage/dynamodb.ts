import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

const DOCUMENT_MAPPING_BASE_NAME = 'cloud-storage-document-mapping-table';

export const getDocumentMappingTable = () => {
  const cloudStorageDocumentMappingTable = new aws.dynamodb.Table(
    `${DOCUMENT_MAPPING_BASE_NAME}-${stack}`,
    {
      // required unique PK
      attributes: [
        { name: 'DocumentId', type: 'S' },
        { name: 'DocumentVersionId', type: 'N' }, // Sort key
      ],
      hashKey: 'DocumentId',
      rangeKey: 'DocumentVersionId',
      // TODO: may want provisioned for prod
      billingMode: 'PAY_PER_REQUEST',
    }
  );

  // Attach IAM policy that grants read access to the DynamoDB table
  const cloudStorageDocumentMappingTablePolicy = new aws.iam.Policy(
    `${DOCUMENT_MAPPING_BASE_NAME}-read-access-policy-${stack}`,
    {
      policy: pulumi.interpolate`{
              "Version": "2012-10-17",
              "Statement": [
                  {
                      "Effect": "Allow",
                      "Action": [
                          "dynamodb:GetItem",
                          "dynamodb:Scan",
                          "dynamodb:Query"
                      ],
                      "Resource": [
                          "${cloudStorageDocumentMappingTable.arn}",
                          "${cloudStorageDocumentMappingTable.arn}/index/*"
                      ]
                  }
              ]
              }`,
    }
  );

  return {
    table: cloudStorageDocumentMappingTable,
    policy: cloudStorageDocumentMappingTablePolicy,
  };
};
