const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const releaseDir = path.resolve(process.env.TESSERA_RELEASE_DIR || 'release');
const requestedArchs = new Set(process.argv.slice(2));
const notaryTimeout = process.env.TESSERA_NOTARY_TIMEOUT || '45m';
const disableS3Acceleration = process.env.TESSERA_NOTARY_DISABLE_S3_ACCELERATION !== '0';

function isDmgForRequestedArch(filePath) {
  if (!filePath.endsWith('.dmg')) return false;
  if (requestedArchs.size === 0) return true;

  const baseName = path.basename(filePath);
  for (const arch of requestedArchs) {
    if (baseName.includes(`-${arch}.dmg`) || baseName.includes(`-${arch}-`)) {
      return true;
    }
  }

  return false;
}

async function findDmgFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findDmgFiles(entryPath));
    } else if (entry.isFile() && isDmgForRequestedArch(entryPath)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function getNotaryAuthArgs() {
  const {
    APPLE_API_KEY,
    APPLE_API_KEY_ID,
    APPLE_API_ISSUER,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_ID,
    APPLE_KEYCHAIN,
    APPLE_KEYCHAIN_PROFILE,
    APPLE_TEAM_ID,
  } = process.env;

  if (APPLE_KEYCHAIN_PROFILE) {
    return [
      ...(APPLE_KEYCHAIN ? ['--keychain', APPLE_KEYCHAIN] : []),
      '--keychain-profile',
      APPLE_KEYCHAIN_PROFILE,
    ];
  }

  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return [
      '--key',
      APPLE_API_KEY,
      '--key-id',
      APPLE_API_KEY_ID,
      '--issuer',
      APPLE_API_ISSUER,
    ];
  }

  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return [
      '--apple-id',
      APPLE_ID,
      '--password',
      APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      APPLE_TEAM_ID,
    ];
  }

  throw new Error(
    [
      'Missing Apple notarization credentials.',
      'Set APPLE_KEYCHAIN_PROFILE, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER,',
      'or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.',
    ].join(' ')
  );
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

async function notarizeDmg(dmgPath, authArgs) {
  console.log(`[notarize-mac-dmg] verifying DMG signature ${dmgPath}`);
  await run('codesign', ['--verify', '--verbose=2', dmgPath]);

  console.log(`[notarize-mac-dmg] submitting ${dmgPath}`);
  await run('xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    '--wait',
    '--timeout',
    notaryTimeout,
    ...(disableS3Acceleration ? ['--no-s3-acceleration'] : []),
    ...authArgs,
  ]);

  console.log(`[notarize-mac-dmg] stapling ${dmgPath}`);
  await run('xcrun', ['stapler', 'staple', dmgPath]);
  await run('xcrun', ['stapler', 'validate', dmgPath]);
  await run('spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose',
    dmgPath,
  ]);
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS DMG notarization requires a macOS build host with Xcode.');
  }

  const dmgFiles = await findDmgFiles(releaseDir);
  if (dmgFiles.length === 0) {
    const archs = requestedArchs.size > 0 ? ` for ${[...requestedArchs].join(', ')}` : '';
    throw new Error(`No DMG artifacts found in ${releaseDir}${archs}`);
  }

  const authArgs = getNotaryAuthArgs();
  for (const dmgPath of dmgFiles) {
    await notarizeDmg(dmgPath, authArgs);
  }
}

main().catch((error) => {
  console.error(`[notarize-mac-dmg] ${error.message}`);
  process.exitCode = 1;
});
