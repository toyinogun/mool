import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { R2Config } from './config';

export function createR2(cfg: R2Config) {
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
    publicUrl(key: string): string {
      return `${cfg.publicBaseUrl}/${key}`;
    },
    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}
