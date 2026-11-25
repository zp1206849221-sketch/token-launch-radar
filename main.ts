// main.ts — the token launch radar entry program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot (--input <file|dir>, default /input), scores every
// pre-token protocol with the fitted peer model in lib/model.ts, and writes into the output
// directory (--output, or MAKEFUN_OUTPUT_DIR, or /output):
//   board.json    the ranked board the gate reads
//   data.js       the same board, shaped for the dashboard
//   dashboard/    a copy of this repository's static page
//   screenshots/  a copy of this repository's three screenshots
//   dossier.json  the judge's summary, written last with the vendored library
// The run is deterministic: the same snapshot always produces the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token launch radar: ${message}\n`);
  process.exit(code);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory tree of regular files, skipping dotfiles and dot-directories. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  const walk = (src: string, dst: string, prefix: string): void => {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src).sort()) {
      if (name.startsWith('.')) continue;
      const srcPath = join(src, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(srcPath).isDirectory()) {
        walk(srcPath, join(dst, name), rel);
      } else if (statSync(srcPath).isFile()) {
        copyFileSync(srcPath, join(dst, name));
        copied.push(rel);
      }
    }
  };
  walk(from, to, '');
  return copied;
}

const pageFiles = copyTree(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view`, 1);
}
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
}

// Written last: the scorer rebuilds the dossier from this same output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  }),
);

const fit = radar.stats.fit;
process.stdout.write(
  `token launch radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} watchlist, ${board.length} rows ranked\n` +
    `token launch radar: peer fit on ${radar.stats.peerCount} tokenised peers: log10(mcap) = ${fit.a} + ${fit.b} * log10(tvl), R2 ${fit.r2}\n` +
    `token launch radar: wrote board.json, data.js, dashboard (${pageFiles.length} files), screenshots (${shots.length} images), dossier.json\n`,
);
