import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface PackageArtifact {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
}

interface ReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly state: string;
  readonly digest?: string | null;
}

interface PublicationReads {
  readonly github: (args: readonly string[]) => Promise<Buffer>;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

type ArtifactState = 'missing' | 'verified';

export async function inspectPublication(
  tag: string,
  artifact: PackageArtifact,
  { github, fetch }: PublicationReads,
): Promise<{ readonly asset: ArtifactState; readonly registry: ArtifactState; }> {
  const sha256 = `sha256:${createHash('sha256').update(artifact.bytes).digest('hex')}`;
  const integrity = `sha512-${createHash('sha512').update(artifact.bytes).digest('base64')}`;
  const [asset, registry,] = await Promise.all([
    inspectReleaseAsset(tag, artifact.filename, sha256, github),
    inspectRegistryVersion(artifact, integrity, fetch),
  ]);
  return { asset, registry };
}

async function inspectReleaseAsset(
  tag: string,
  filename: string,
  sha256: string,
  github: PublicationReads['github'],
): Promise<ArtifactState> {
  const releaseId = (await github(['api', `repos/{owner}/{repo}/releases/tags/${encodeURIComponent(tag)}`, '--jq', '.id']))
    .toString().trim();
  if (!/^[1-9]\d*$/.test(releaseId)) {
    throw new Error(`GitHub did not return a release ID for ${tag}`);
  }
  const response = await github(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/releases/${releaseId}/assets?per_page=100`]);
  const pages = JSON.parse(response.toString()) as readonly (readonly ReleaseAsset[])[];
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error(`GitHub returned an invalid asset list for ${tag}`);
  }
  const asset = pages.flat().find((candidate) => candidate.name === filename);
  if (asset === undefined) {
    return 'missing';
  }
  if (asset.state !== 'uploaded') {
    throw new Error(`GitHub asset ${filename} for ${tag} is in state ${asset.state}`);
  }
  // Older assets may lack a server digest. Compare their downloaded bytes.
  const digest = asset.digest ?? await github([
    'api',
    `repos/{owner}/{repo}/releases/assets/${asset.id}`,
    '-H',
    'Accept: application/octet-stream',
  ]).then((bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  if (digest !== sha256) {
    throw new Error(`GitHub asset ${filename} for ${tag} differs from the built tarball`);
  }
  return 'verified';
}

async function inspectRegistryVersion(
  { name, version }: PackageArtifact,
  integrity: string,
  fetch: PublicationReads['fetch'],
): Promise<ArtifactState> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000) },
  );
  if (response.status === 404) {
    return 'missing';
  }
  if (!response.ok) {
    throw new Error(`npm lookup for ${name}@${version} failed with HTTP ${response.status}`);
  }
  const published = await response.json() as { readonly dist?: { readonly integrity?: string; }; };
  if (published.dist?.integrity !== integrity) {
    throw new Error(`npm version ${name}@${version} differs from the built tarball`);
  }
  return 'verified';
}

async function github(args: readonly string[]): Promise<Buffer> {
  const process = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status,] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (status !== 0) {
    throw new Error(`GitHub lookup failed with exit code ${status}\n${stderr.trim()}`);
  }
  return Buffer.from(stdout);
}

if (import.meta.main) {
  const [tag, tarball,] = Bun.argv.slice(2);
  const output = Bun.env.GITHUB_OUTPUT;
  if (tag === undefined || tarball === undefined || output === undefined) {
    throw new Error('Expected the release tag, tarball path, and GITHUB_OUTPUT');
  }
  const { name, version } = await Bun.file('package.json').json() as { readonly name?: unknown; readonly version?: unknown; };
  if (typeof name !== 'string' || typeof version !== 'string' || tag.replace(/^v/, '') !== version) {
    throw new Error('Release tag and package manifest must identify the same version');
  }
  const { asset, registry } = await inspectPublication(tag, {
    name,
    version,
    filename: basename(tarball),
    bytes: new Uint8Array(await Bun.file(tarball).arrayBuffer()),
  }, { github, fetch });
  await appendFile(output, `asset=${asset}\nregistry=${registry}\n`);
  console.log(`GitHub release asset ${asset}. npm version ${registry}.`);
}
