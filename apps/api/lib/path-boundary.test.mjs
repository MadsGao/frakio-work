import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveInsideRoot } from './path-boundary.mjs';

test('workspace boundary accepts descendants and rejects POSIX traversal', () => {
  assert.equal(resolveInsideRoot('/work/root', '/work/root/docs/a.md', path.posix), '/work/root/docs/a.md');
  assert.throws(() => resolveInsideRoot('/work/root', '/work/secret.txt', path.posix), { status: 403 });
});

test('workspace boundary handles Windows drive paths', () => {
  assert.equal(resolveInsideRoot('C:\\work\\root', 'C:\\work\\root\\docs\\a.md', path.win32), 'C:\\work\\root\\docs\\a.md');
  assert.throws(() => resolveInsideRoot('C:\\work\\root', 'D:\\secret.txt', path.win32), { status: 403 });
});
