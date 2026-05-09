import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { R2Config } from './config';

export interface R2 {
  mintUploadUrl(args: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<string>;
  publicUrl(key: string): string;
}

export function createR2(cfg: R2Config): R2 {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });

  return {
    async mintUploadUrl({ key, contentType, sizeBytes }) {
      const cmd = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      });
      // 15-minute expiry — long enough for a 500 MB upload over slow links,
      // short enough that a leaked URL is not durably abusable.
      return getSignedUrl(client, cmd, { expiresIn: 60 * 15 });
    },
    publicUrl(key) {
      return `${cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    },
  };
}
