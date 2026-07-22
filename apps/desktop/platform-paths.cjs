const path = require('node:path');

function electronNodeExecutable({ packaged, platform, resourcesPath, execPath, appName = 'Frakio Work' }) {
  if (!packaged || platform === 'win32') return path.resolve(execPath);
  if (platform === 'darwin') return path.join(resourcesPath, '..', 'MacOS', appName);
  return path.resolve(execPath);
}

module.exports = { electronNodeExecutable };
