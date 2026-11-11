// Mutation check: break one line of a source file, run the given tests, report whether they notice, restore the file.
// Usage: node scripts/mutate.mjs <file> <search> <replace> <compiled test file>...
// The file must be clean in Git (it is restored with `git checkout`), and the test files are the compiled ones in out/test/.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [file, search, replace, ...tests] = process.argv.slice(2);
if (!file || search === undefined || replace === undefined || !tests.length) {
  console.error('usage: node scripts/mutate.mjs <file> <search> <replace> <out/test/x.test.js>...');
  process.exit(2);
}
if (execFileSync('git', ['status', '--porcelain', '--', file], { encoding: 'utf8' }).trim()) {
  console.error(`${file} has uncommitted changes; the mutation would be restored over them. Stop.`);
  process.exit(2);
}
const source = readFileSync(file, 'utf8');
if (!source.includes(search)) { console.error(`"${search}" is not in ${file}`); process.exit(2); }
try {
  writeFileSync(file, source.replace(search, replace));
  const build = spawnSync('npx', ['tsc', '-p', '.'], { shell: true, stdio: 'ignore' });
  if (build.status !== 0) { console.log('INVALID (the mutation does not compile)'); process.exitCode = 3; throw undefined; }
  const run = spawnSync('node', ['--test', ...tests], { encoding: 'utf8' });
  const failed = [...run.stdout.matchAll(/^\s*✖ (.+?) \(/gm)].map(m => m[1]).filter((n, i, a) => a.indexOf(n) === i);
  console.log(run.status === 0 ? 'SURVIVED (no test noticed)' : `KILLED by: ${failed.slice(0, 4).join(' | ')}`);
} catch (e) {
  if (e !== undefined) throw e;
} finally {
  execFileSync('git', ['checkout', '--', file]);
}
