import path from 'node:path';

export function isSystemHermesProfile(profileName, agentId = '') {
  return String(profileName || '').trim().toLowerCase() === 'default'
    || String(agentId || '').trim().toLowerCase() === 'hermes-default';
}

export function userVisibleHermesProfiles(profiles = []) {
  return profiles.filter((profile) => !isSystemHermesProfile(profile?.name));
}

export function resolveDeletableHermesProfileDir(hermesHome, profileName, pathApi = path) {
  if (isSystemHermesProfile(profileName)) {
    const error = new Error('Hermes Default 是受保护的系统 Profile。');
    error.status = 409;
    error.code = 'system_profile_protected';
    throw error;
  }

  const clean = String(profileName || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clean)) {
    const error = new Error('Agent Profile 名称不合法。');
    error.status = 400;
    error.code = 'invalid_profile_name';
    throw error;
  }

  const profilesRoot = pathApi.resolve(hermesHome, 'profiles');
  const target = pathApi.resolve(profilesRoot, clean);
  const relative = pathApi.relative(profilesRoot, target);
  if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) {
    const error = new Error('Agent Profile 路径超出可删除范围。');
    error.status = 403;
    error.code = 'profile_path_forbidden';
    throw error;
  }
  return target;
}
