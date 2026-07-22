const path = require('node:path');

function electronNodeExecutable({ packaged, platform, resourcesPath, execPath, appName = 'Frakio Work' }) {
  if (!packaged || platform === 'win32') return execPath;
  if (platform === 'darwin') return path.posix.join(resourcesPath, '..', 'MacOS', appName);
  return execPath;
}

module.exports = { electronNodeExecutable };
