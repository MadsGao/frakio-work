import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAttachmentStore, MAX_ATTACHMENT_BYTES, sanitizeAttachmentName } from './attachment-store.mjs';

test('attachment store saves unicode files and exposes safe metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-attachments-'));
  const store = createAttachmentStore(root);
  const attachment = await store.save({ name: '../截图 你好.png', mimeType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) });
  assert.equal(attachment.name, '截图 你好.png');
  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.mimeType, 'image/png');
  assert.match(attachment.contentUrl, new RegExp(attachment.id));
  const resolved = await store.content(attachment.id);
  assert.deepEqual(await readFile(resolved.filePath), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
});

test('attachment store rejects unknown and oversized files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-attachments-'));
  const store = createAttachmentStore(root);
  await assert.rejects(store.save({ name: 'payload.bin', mimeType: 'application/octet-stream', data: Buffer.from('x') }), { status: 415 });
  await assert.rejects(store.save({ name: 'large.txt', mimeType: 'text/plain', data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) }), { status: 413 });
  assert.equal(sanitizeAttachmentName('../../report.md'), 'report.md');
});

test('attachment claims persist and claimed files cannot be removed as drafts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-attachments-'));
  const store = createAttachmentStore(root);
  const attachment = await store.save({ name: 'notes.md', mimeType: 'text/markdown', data: Buffer.from('# Notes') });
  const metadata = await store.resolveMany([attachment.id]);
  await store.claim(metadata, 'thread-1', 'message-1');
  assert.equal((await store.metadataFor(attachment.id)).threadId, 'thread-1');
  await assert.rejects(store.removeDraft(attachment.id), { status: 409 });
  assert.equal(await store.removeForThreads(['thread-1']), 1);
  await assert.rejects(store.metadataFor(attachment.id), { status: 404 });
});

test('attachment content rejects a stored path outside its attachment directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frakio-attachments-'));
  const store = createAttachmentStore(root);
  const attachment = await store.save({ name: 'notes.md', mimeType: 'text/markdown', data: Buffer.from('# Notes') });
  const metadataPath = path.join(root, attachment.id, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.storedName = '../../outside.txt';
  await writeFile(path.join(root, 'outside.txt'), 'must not be exposed');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  await assert.rejects(store.content(attachment.id), {
    status: 500,
    code: 'ATTACHMENT_METADATA_INVALID',
  });
});
