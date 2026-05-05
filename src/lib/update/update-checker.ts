import { getServerHostInfo } from '@/lib/system/server-host';
import type { ServerHostInfo } from '@/lib/system/types';
import type { UpdateCheckResponse, UpdateSource } from './types';
import { isNewerVersion, pickLatestVersion } from './version';

const PACKAGE_NAME = '@horang-labs/tessera';
const GITHUB_REPO = 'horang-labs/tessera';
const CHECK_TIMEOUT_MS = 10_000;

interface NpmRegistryResponse {
  versions?: Record<string, unknown>;
  'dist-tags'?: Record<string, string>;
}

interface GithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
}

interface LatestVersionCandidate {
  version: string | null;
  releaseUrl: string | null;
}

function buildResponse(
  hostInfo: ServerHostInfo,
  source: UpdateSource,
  candidate: LatestVersionCandidate,
): UpdateCheckResponse {
  const updateAvailable = isNewerVersion(candidate.version, hostInfo.appVersion);

  return {
    status: updateAvailable ? 'available' : 'current',
    currentVersion: hostInfo.appVersion,
    latestVersion: candidate.version,
    updateAvailable,
    source,
    channel: hostInfo.channel,
    releaseUrl: candidate.releaseUrl,
    installCommand: source === 'npm' && candidate.version
      ? `npm install -g ${PACKAGE_NAME}@${candidate.version}`
      : null,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

function unsupportedResponse(hostInfo: ServerHostInfo): UpdateCheckResponse {
  return {
    status: 'unsupported',
    currentVersion: hostInfo.appVersion,
    latestVersion: null,
    updateAvailable: false,
    source: 'unsupported',
    channel: hostInfo.channel,
    releaseUrl: null,
    installCommand: null,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

function errorResponse(hostInfo: ServerHostInfo, source: UpdateSource, error: unknown): UpdateCheckResponse {
  return {
    status: 'error',
    currentVersion: hostInfo.appVersion,
    latestVersion: null,
    updateAvailable: false,
    source,
    channel: hostInfo.channel,
    releaseUrl: null,
    installCommand: null,
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : 'Update check failed',
  };
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Tessera update checker',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Update check request failed with status ${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLatestNpmVersion(fetchImpl: typeof fetch): Promise<LatestVersionCandidate> {
  const encodedPackageName = encodeURIComponent(PACKAGE_NAME);
  const registry = await fetchJson<NpmRegistryResponse>(
    `https://registry.npmjs.org/${encodedPackageName}`,
    fetchImpl,
  );

  const versions = new Set<string>([
    ...Object.keys(registry.versions ?? {}),
    ...Object.values(registry['dist-tags'] ?? {}),
  ]);
  const version = pickLatestVersion(versions);

  return {
    version,
    releaseUrl: version
      ? `https://www.npmjs.com/package/${PACKAGE_NAME}/v/${version}`
      : `https://www.npmjs.com/package/${PACKAGE_NAME}`,
  };
}

async function getLatestGithubRelease(fetchImpl: typeof fetch): Promise<LatestVersionCandidate> {
  const releases = await fetchJson<GithubReleaseResponse[]>(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=50`,
    fetchImpl,
  );
  const candidates = releases
    .filter((release) => !release.draft && typeof release.tag_name === 'string')
    .map((release) => ({
      version: release.tag_name!.replace(/^v/, ''),
      releaseUrl: release.html_url ?? null,
    }))
    .filter((release) => release.version);

  const version = pickLatestVersion(candidates.map((release) => release.version));
  const releaseUrl = candidates.find((release) => release.version === version)?.releaseUrl ?? null;

  return { version, releaseUrl };
}

export async function checkForUpdates(
  hostInfo: ServerHostInfo = getServerHostInfo(),
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResponse> {
  if (hostInfo.channel === 'npm') {
    try {
      return buildResponse(hostInfo, 'npm', await getLatestNpmVersion(fetchImpl));
    } catch (error) {
      return errorResponse(hostInfo, 'npm', error);
    }
  }

  if (hostInfo.channel === 'github-release') {
    try {
      return buildResponse(hostInfo, 'github-release', await getLatestGithubRelease(fetchImpl));
    } catch (error) {
      return errorResponse(hostInfo, 'github-release', error);
    }
  }

  return unsupportedResponse(hostInfo);
}
