import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  isSystemHermesProfile,
  resolveDeletableHermesProfileDir,
  userVisibleHermesProfiles,
} from './hermes-profile-safety.mjs';

test('Hermes Default is internal and hidden from user-visible profiles', () => {
  assert.equal(isSystemHermesProfile('default'), true);
  assert.equal(isSystemHermesProfile('iris', 'hermes-default'), true);
  assert.deepEqual(userVisibleHermesProfiles([{ name: 'default' }, { name: 'iris' }]), [{ name: 'iris' }]);
});

test('profile deletion rejects Hermes root and resolves only named descendants', () => {
  assert.throws(
    () => resolveDeletableHermesProfileDir('/home/user/.hermes', 'default', path.posix),
    { status: 409, code: 'system_profile_protected' },
  );
  assert.equal(
    resolveDeletableHermesProfileDir('/home/user/.hermes', 'iris', path.posix),
    '/home/user/.hermes/profiles/iris',
  );
  assert.throws(
    () => resolveDeletableHermesProfileDir('/home/user/.hermes', '../default', path.posix),
    { status: 400, code: 'invalid_profile_name' },
  );
});
