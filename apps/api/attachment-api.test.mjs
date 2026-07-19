import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('attachment API uploads, reads, and deletes a draft attachment', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'frakio-attachment-api-'));
  const home = path.join(parent, '.frakio-work');
  await mkdir(home);
  process.env.FRAKIO_WORK_HOME = home;
  process.env.FRAKIO_WORK_DISABLE_AUTOSTART = '1';
  process.env.PORT = '0';

  const module = await import(`./server.mjs?attachment-api=${Date.now()}`);
  const app = await module.createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sessionResponse = await fetch(`${baseUrl}/api/session`);
  assert.equal(sessionResponse.status, 200);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const uploadResponse = await fetch(`${baseUrl}/api/attachments?name=${encodeURIComponent('../截图 测试.png')}`, {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      cookie,
      'x-frakio-request': '1',
    },
    body: png,
  });
  assert.equal(uploadResponse.status, 201);
  const { attachment } = await uploadResponse.json();
  assert.equal(attachment.name, '截图 测试.png');
  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.size, png.length);

  const contentResponse = await fetch(`${baseUrl}${attachment.contentUrl}`, {
    headers: { cookie, 'x-frakio-request': '1' },
  });
  assert.equal(contentResponse.status, 200);
  assert.equal(contentResponse.headers.get('content-type'), 'image/png');
  assert.equal(contentResponse.headers.get('content-length'), String(png.length));
  assert.equal(contentResponse.headers.get('content-disposition'), "inline; filename*=UTF-8''%E6%88%AA%E5%9B%BE%20%E6%B5%8B%E8%AF%95.png");
  assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), png);

  const deleteResponse = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, {
    method: 'DELETE',
    headers: { cookie, 'x-frakio-request': '1' },
  });
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deletedAttachmentId, attachment.id);

  await assert.rejects(readFile(path.join(home, 'attachments', attachment.id, 'metadata.json')));
});
