const assert = require('node:assert/strict');
const test = require('node:test');
const { electronNodeExecutable } = require('./platform-paths.cjs');

test('packaged desktop resolves the Electron node executable per platform', () => {
  assert.equal(electronNodeExecutable({
    packaged: true,
    platform: 'darwin',
    resourcesPath: '/Applications/Frakio Work.app/Contents/Resources',
    execPath: '/Applications/Frakio Work.app/Contents/MacOS/Frakio Work',
  }), '/Applications/Frakio Work.app/Contents/MacOS/Frakio Work');

  const windowsExecutable = String.raw`C:\Users\runner\AppData\Local\Programs\frakio-work\Frakio Work.exe`;
  assert.equal(electronNodeExecutable({
    packaged: true,
    platform: 'win32',
    resourcesPath: String.raw`C:\Users\runner\AppData\Local\Programs\frakio-work\resources`,
    execPath: windowsExecutable,
  }), windowsExecutable);
});
