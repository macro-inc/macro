import {
  uploadDocx,
  uploadPdf,
} from '../../../src/handlers/results/uploadFile';
/* eslint-disable @typescript-eslint/unbound-method */
import type { S3 } from '../../../src/service/s3Service';

describe('uploadFile', () => {
  describe('uploadPdf', () => {
    test('success', async () => {
      const s3Client = {
        putObject: jest.fn(),
        getPresignedUrl: jest.fn(() => 'url'),
      } as any as S3;

      const result = await uploadPdf(
        s3Client,
        'bucket',
        'job',
        new ArrayBuffer(0)
      );
      expect(result).toBe('url');
      expect(s3Client.putObject).toHaveBeenCalledWith(
        'bucket',
        expect.stringContaining('.pdf'),
        new ArrayBuffer(0)
      );
    });
    test('fails', async () => {
      const s3Client = {
        putObject: jest.fn(),
        getPresignedUrl: jest.fn(() => {
          throw new Error('bad');
        }),
      } as any as S3;

      await expect(() =>
        uploadPdf(s3Client, 'bucket', 'job', new ArrayBuffer(0))
      ).rejects.toThrowError('bad');
    });
  });
  describe('uploadDocx', () => {
    test('success', async () => {
      const s3Client = {
        putObject: jest.fn(),
        getPresignedUrl: jest.fn(() => 'url'),
      } as any as S3;

      const result = await uploadDocx(
        s3Client,
        'bucket',
        'job',
        new ArrayBuffer(0)
      );
      expect(result).toBe('url');
      expect(s3Client.putObject).toHaveBeenCalledWith(
        'bucket',
        expect.stringContaining('.docx'),
        new ArrayBuffer(0)
      );
    });
    test('fails', async () => {
      const s3Client = {
        putObject: jest.fn(),
        getPresignedUrl: jest.fn(() => {
          throw new Error('bad');
        }),
      } as any as S3;

      await expect(() =>
        uploadDocx(s3Client, 'bucket', 'job', new ArrayBuffer(0))
      ).rejects.toThrowError('bad');
    });
  });
});
