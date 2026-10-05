/**
 * S3 client for a Railway bucket.
 * Railway's bucket variable references use ENDPOINT, REGION, BUCKET,
 * ACCESS_KEY_ID, and SECRET_ACCESS_KEY. This module does not set them
 * and does not create a bucket.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

function isMissingObject(err) {
  const name = err?.name || err?.Code || err?.code;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  return err?.$metadata?.httpStatusCode === 404;
}

export function railwayS3ClientConfig(config) {
  return {
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: false,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

export function createS3BackupClient(config, deps = {}) {
  if (!config?.endpoint || !config?.region || !config?.bucket || !config?.accessKeyId || !config?.secretAccessKey) {
    throw new Error('Refusing to backup: bucket client config is incomplete');
  }
  const s3 = deps.s3 ?? new S3Client(railwayS3ClientConfig(config));
  const bucketName = config.bucket;
  return {
    bucket: bucketName,
    async putObject({ bucket = bucketName, key, body }) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: 'application/json',
      }));
    },
    async getObject({ bucket = bucketName, key }) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out?.Body) return Buffer.alloc(0);
        return Buffer.from(await out.Body.transformToByteArray());
      } catch (err) {
        if (isMissingObject(err)) return null;
        throw err;
      }
    },
    async deleteObject({ bucket = bucketName, key }) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async listObjects({ bucket = bucketName, prefix }) {
      const keys = [];
      let token;
      do {
        const out = await s3.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }));
        for (const item of out.Contents ?? []) {
          if (item?.Key) keys.push({ key: item.Key });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
  };
}
