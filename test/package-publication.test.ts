import {
  expect,
  test,
} from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectPublication } from '../scripts/package-publication';

const artifact = {
  name: '@konstit/cli',
  version: '1.0.0',
  filename: 'konstit-cli-1.0.0.tgz',
  bytes: Buffer.from('built package'),
};
const tag = 'v1.0.0';
const uploaded = {
  id: 456,
  state: 'uploaded',
  name: artifact.filename,
  digest: `sha256:${createHash('sha256').update(artifact.bytes).digest('hex')}`,
};
const integrity = `sha512-${createHash('sha512').update(artifact.bytes).digest('base64')}`;

function lookup(assetPages: readonly (readonly object[])[], registry: Response) {
  return {
    github: async (args: readonly string[]) => {
      switch (args.join(' ')) {
        case 'api repos/{owner}/{repo}/releases/tags/v1.0.0 --jq .id':
          return Buffer.from('123\n');
        case 'api --paginate --slurp repos/{owner}/{repo}/releases/123/assets?per_page=100':
          return Buffer.from(JSON.stringify(assetPages));
        case 'api repos/{owner}/{repo}/releases/assets/456 -H Accept: application/octet-stream':
          return artifact.bytes;
        default:
          throw new Error(`Unexpected GitHub request ${args.join(' ')}`);
      }
    },
    fetch: async (url: string) => {
      expect(url).toBe('https://registry.npmjs.org/%40konstit%2Fcli/1.0.0');
      return registry;
    },
  };
}

test.each(
  [
    { asset: 'missing', registry: 'missing' },
    { asset: 'verified', registry: 'missing' },
    { asset: 'verified', registry: 'verified' },
    { asset: 'missing', registry: 'verified' },
  ] as const,
)('reports publication state with asset $asset and registry $registry', async (expected) => {
  const assetPages = expected.asset === 'verified' ? [[], [uploaded]] : [[]];
  const npm = expected.registry === 'verified' ? Response.json({ dist: { integrity } }) : new Response(null, { status: 404 });
  expect(await inspectPublication(tag, artifact, lookup(assetPages, npm))).toEqual(expected);
});

test('verifies an older GitHub asset by comparing its bytes', async () => {
  const npm = new Response(null, { status: 404 });
  const readers = lookup([[{ ...uploaded, digest: null }]], npm);
  expect(await inspectPublication(tag, artifact, readers)).toEqual({ asset: 'verified', registry: 'missing' });
});

test.each([
  { asset: { ...uploaded, digest: 'sha256:different' }, error: 'differs from the built tarball' },
  { asset: { ...uploaded, state: 'starter' }, error: 'is in state starter' },
])('rejects a conflicting or unfinished GitHub asset', async ({ asset, error }) => {
  const readers = lookup([[asset]], new Response(null, { status: 404 }));
  await assert.rejects(
    inspectPublication(tag, artifact, readers),
    (reason: unknown) => reason instanceof Error && reason.message.includes(error),
  );
});

test.each([
  { response: () => Response.json({ dist: { integrity: 'sha512-different' } }), error: 'differs from the built tarball' },
  { response: () => new Response(null, { status: 503 }), error: 'failed with HTTP 503' },
])('rejects an npm conflict or lookup failure', async ({ response, error }) => {
  await assert.rejects(
    inspectPublication(tag, artifact, lookup([[]], response())),
    (reason: unknown) => reason instanceof Error && reason.message.includes(error),
  );
});
