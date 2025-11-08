import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Logger } from '../utils/logger';

// 2 minute expiration
const PRESIGNED_URL_EXPIRATION = 120;

export class S3 {
  private inner: S3Client;
  private logger: Logger;
  constructor(logger: Logger) {
    this.inner = new S3Client({ region: 'us-east-1' });
    this.logger = logger;
    this.logger.debug('initiated S3 client');
  }

  async getObject(bucket: string, key: string) {
    this.logger.debug('getObject', { bucket, key });
    const result = await this.inner.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return await result.Body?.transformToByteArray();
  }

  async putObject(bucket: string, key: string, data: ArrayBuffer) {
    this.logger.debug('putObject', { bucket, key });
    await this.inner.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: new Uint8Array(data),
      })
    );
  }

  async getPresignedUrl(bucket: string, key: string) {
    this.logger.debug('getPresignedUrl', { bucket, key });
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.inner, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION,
    });
  }

  async putPresignedUrl(
    bucket: string,
    key: string,
    sha: string,
    fileType: string
  ) {
    this.logger.debug('putPresignedUrl', { bucket, key, sha, fileType });
    // decode hex sha to binary and convert to base64
    const encodedSha = Buffer.from(sha, 'hex').toString('base64').toString();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ChecksumSHA256: encodedSha,
      ContentType:
        fileType === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
    });

    const signableHeaders = new Set(['content-type']);
    return getSignedUrl(this.inner, command, {
      signableHeaders,
      expiresIn: PRESIGNED_URL_EXPIRATION,
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
  }
}

let _s3Client: S3;

export function s3Client(logger?: Logger) {
  if (!_s3Client) {
    if (!logger) {
      throw new Error('logger needed to initialize s3 singleton');
    }
    _s3Client = new S3(logger);
  }
  return _s3Client;
}
