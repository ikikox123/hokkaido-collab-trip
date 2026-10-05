import test from 'node:test';
import assert from 'node:assert/strict';
import { createS3BackupClient, railwayS3ClientConfig } from './s3BackupClient.js';

const config = {
  endpoint: 'https://example.invalid',
  region: 'auto',
  bucket: 'fixture-bucket',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

function fakeS3(pages) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      const name = command.constructor.name;
      if (name === 'ListObjectsV2Command') {
        const page = pages[command.input.ContinuationToken ? 1 : 0];
        return page;
      }
      if (name === 'GetObjectCommand') {
        if (command.input.Key === 'missing') {
          const error = new Error('not found');
          error.name = 'NoSuchKey';
          throw error;
        }
        if (command.input.Key === 'broken') {
          const error = new Error('denied');
          error.name = 'AccessDenied';
          error.$metadata = { httpStatusCode: 403 };
          throw error;
        }
        return { Body: { transformToByteArray: async () => Buffer.from('{"ok":true}') } };
      }
      if (name === 'PutObjectCommand' || name === 'DeleteObjectCommand') return {};
      throw new Error(`unexpected ${name}`);
    },
  };
}

test('bucket client lists every page and does not send when constructed', async () => {
  const s3 = fakeS3([
    {
      Contents: [{ Key: 'backups/20260801T000000000Z/state.json' }],
      IsTruncated: true,
      NextContinuationToken: 'next',
    },
    {
      Contents: [{ Key: 'backups/20260801T000000000Z/users.json' }],
      IsTruncated: false,
    },
  ]);
  const client = createS3BackupClient(config, { s3 });
  assert.equal(client.bucket, 'fixture-bucket');
  const listed = await client.listObjects({ bucket: 'fixture-bucket', prefix: 'backups/' });
  assert.deepEqual(listed, [
    { key: 'backups/20260801T000000000Z/state.json' },
    { key: 'backups/20260801T000000000Z/users.json' },
  ]);
  assert.equal(s3.calls[0].input.Bucket, 'fixture-bucket');
  assert.equal(s3.calls[0].input.Prefix, 'backups/');
  assert.equal(s3.calls[1].input.ContinuationToken, 'next');

  const body = await client.getObject({ bucket: 'fixture-bucket', key: 'backups/20260801T000000000Z/state.json' });
  assert.equal(body.toString('utf8'), '{"ok":true}');
  assert.equal(await client.getObject({ bucket: 'fixture-bucket', key: 'missing' }), null);
  await assert.rejects(() => client.getObject({ bucket: 'fixture-bucket', key: 'broken' }), /denied/);

  await client.putObject({ bucket: 'fixture-bucket', key: 'backups/20260801T000000000Z/state.json', body: Buffer.from('{}') });
  await client.deleteObject({ bucket: 'fixture-bucket', key: 'backups/20260801T000000000Z/state.json' });
  const put = s3.calls.find((command) => command.constructor.name === 'PutObjectCommand');
  assert.equal(put.input.Bucket, 'fixture-bucket');
  assert.equal(put.input.ContentType, 'application/json');
  assert.equal(put.input.ACL, undefined);
  assert.equal(s3.calls.some((command) => command.constructor.name === 'S3Client'), false);
});

test('incomplete bucket config does not build a client or echo secrets', () => {
  assert.throws(
    () => createS3BackupClient({ ...config, secretAccessKey: '' }),
    (err) => err.message === 'Refusing to backup: bucket client config is incomplete' && !err.message.includes('test-access-key'),
  );
});

test('Railway bucket client uses virtual-hosted style and the supplied endpoint', () => {
  const options = railwayS3ClientConfig(config);
  assert.equal(options.endpoint, 'https://example.invalid');
  assert.equal(options.region, 'auto');
  assert.equal(options.forcePathStyle, false);
  assert.equal(options.requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.equal(options.responseChecksumValidation, 'WHEN_REQUIRED');
  assert.equal(options.credentials.accessKeyId, 'test-access-key');
});
