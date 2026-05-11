import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { R2Config } from './config';

export interface R2 {
  mintUploadUrl(args: { key: string; contentType: string; sizeBytes: number }): Promise<string>;
  mintViewUrl(args: { key: string; ttlSeconds: number }): Promise<string>;
  deleteObject(key: string): Promise<void>;
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
    async mintUploadUrl({
      key,
      contentType,
      sizeBytes,
    }: {
      key: string;
      contentType: string;
      sizeBytes: number;
    }): Promise<string> {
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
    async mintViewUrl({ key, ttlSeconds }: { key: string; ttlSeconds: number }): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: ttlSeconds });
    },
    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}
