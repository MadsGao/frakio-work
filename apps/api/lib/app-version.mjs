export async function resolveAppVersion({ envVersion = '', packagePath = '', readFileImpl } = {}) {
  const fromEnvironment = String(envVersion || '').trim();
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(fromEnvironment)) return fromEnvironment;
  if (packagePath && readFileImpl) {
    try {
      const raw = await readFileImpl(packagePath, 'utf8');
      const fromPackage = String(JSON.parse(raw)?.version || '').trim();
      if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(fromPackage)) return fromPackage;
    } catch {
      // Packaged ASAR builds intentionally fall back to the Electron-provided version.
    }
  }
  return '0.0.0';
}
