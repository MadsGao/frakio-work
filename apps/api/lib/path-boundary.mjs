import path from 'node:path';

export function resolveInsideRoot(rootPath, targetPath, pathApi = path) {
  const root = pathApi.resolve(rootPath);
  const target = pathApi.resolve(targetPath);
  const relative = pathApi.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))) return target;
  const error = new Error('目标路径超出当前 Workspace Root。');
  error.status = 403;
  throw error;
}
