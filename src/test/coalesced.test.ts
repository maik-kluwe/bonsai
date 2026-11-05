import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { coalesced } from '../coalesced';

/** A run that stays open until the test lets it finish. */
function gated() {
  const gates: (() => void)[] = [];
  let runs = 0;
  const run = () => new Promise<void>(resolve => { runs++; gates.push(resolve); });
  return { run, release: () => gates.shift()!(), runs: () => runs };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('coalesced', () => {
  test('one call, one run', async () => {
    const g = gated();
    const call = coalesced(g.run)();
    g.release();
    await call;
    assert.equal(g.runs(), 1);
  });

  test('calls during a run lead to exactly one more', async () => {
    const g = gated();
    const go = coalesced(g.run);
    const first = go();
    await go();
    await go();
    assert.equal(g.runs(), 1, 'never two at once');
    g.release();
    await tick();
    assert.equal(g.runs(), 2);
    g.release();
    await first;
    assert.equal(g.runs(), 2);
  });

  test('a failed run does not block the next one', async () => {
    let runs = 0;
    const go = coalesced(async () => { if (++runs === 1) throw new Error('no'); });
    await assert.rejects(go(), /no/);
    await go();
    assert.equal(runs, 2);
  });
});
