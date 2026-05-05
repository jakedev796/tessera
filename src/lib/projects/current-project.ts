function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function parentComparablePath(value: string): string {
  const normalized = normalizeComparablePath(value);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized;
}

export function isElectronAppRuntimeProjectPath(
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.TESSERA_ELECTRON_SERVER !== '1') return false;

  const normalizedProjectPath = normalizeComparablePath(projectPath);
  const appRoot = env.TESSERA_APP_ROOT;

  if (appRoot) {
    const normalizedAppRoot = normalizeComparablePath(appRoot);
    const normalizedResourcesPath = parentComparablePath(normalizedAppRoot);

    if (
      normalizedProjectPath === normalizedAppRoot ||
      normalizedProjectPath === normalizedResourcesPath
    ) {
      return true;
    }
  }

  return /\.app\/Contents\/Resources(?:$|\/)/.test(normalizedProjectPath);
}

export function shouldAutoRegisterCurrentProject(
  currentProjectPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isElectronAppRuntimeProjectPath(currentProjectPath, env);
}
