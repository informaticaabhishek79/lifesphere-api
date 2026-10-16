import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Env, ENV } from '../config/env';

/** S3-compatible object storage (Cloudflare R2, AWS S3, MinIO) or local disk in development. */
@Injectable()
export class StorageAdapter {
  private s3: S3Client | null = null;
  private readonly localDir: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.localDir = path.resolve(env.STORAGE_LOCAL_DIR);
    if (env.STORAGE_PROVIDER === 's3') {
      this.s3 = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: !!env.S3_ENDPOINT,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
      });
    }
  }

  get provider() {
    return this.env.STORAGE_PROVIDER;
  }

  private localPath(key: string) {
    const p = path.resolve(this.localDir, key);
    if (!p.startsWith(this.localDir + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: this.env.S3_ENDPOINT ? undefined : 'AES256' }),
      );
      return;
    }
    const p = this.localPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }

  async getStream(key: string): Promise<Readable> {
    if (this.s3) {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return out.Body as Readable;
    }
    return createReadStream(this.localPath(key));
  }

  /** Short-lived download URL (S3) or null when the API must stream the file itself (local). */
  async signedUrl(key: string, filename: string, seconds = 300): Promise<string | null> {
    if (!this.s3) return null;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }),
      { expiresIn: seconds },
    );
  }

  async delete(key: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }
}
