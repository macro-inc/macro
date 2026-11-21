// What the host's role may do in its backup bucket: write and read GoAlert's
// nightly dumps under `goalert/`, nothing else. Production's role and the smoke
// host's both get these statements, so the smoke boot's backup proves them.
export function backupStatements(bucketArn: string) {
  return [
    {
      Effect: 'Allow',
      Action: 's3:ListBucket',
      Resource: bucketArn,
      Condition: { StringLike: { 's3:prefix': 'goalert/*' } },
    },
    {
      Effect: 'Allow',
      Action: [
        's3:GetObject',
        's3:PutObject',
        's3:AbortMultipartUpload',
        's3:ListMultipartUploadParts',
      ],
      Resource: `${bucketArn}/goalert/*`,
    },
  ];
}
