import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { Prompts } from '../prompts';
import type { ToWebview } from '../protocol';

type Asked = Extract<ToWebview, { type: 'ask' }>;

const prompts = () => {
  const asked: Asked[] = [];
  const p = new Prompts(m => asked.push(m as Asked));
  return { p, asked, last: () => asked[asked.length - 1] };
};

describe('Prompts', () => {
  test('every kind of question gets its answer back as the flows expect it', async () => {
    const { p, last } = prompts();
    const reply = <T>(question: Promise<T>, value?: string | number[]) => { p.answer(last().id, value); return question; };
    assert.equal(await reply(p.ui.confirm('Sure?', 'Delete'), [0]), true);
    assert.equal(await reply(p.ui.confirm('Sure?', 'Delete')), false, 'cancelled');
    assert.equal(await reply(p.ui.choose('Which?', ['a', 'b']), [1]), 'b');
    assert.equal(await reply(p.ui.input('Name', 'old'), ''), '', 'an empty text is an answer');
    assert.equal(await reply(p.ui.input('Name')), undefined);

    const items = [{ label: 'x', mode: 'soft' }, { label: 'y', mode: 'hard' }];
    const one = p.ui.pick(items, { title: 'T' });
    assert.deepEqual(last().question, { kind: 'one', title: 'T', hint: undefined, action: undefined, facts: undefined, items: [{ label: 'x', description: undefined, detail: undefined, picked: undefined }, { label: 'y', description: undefined, detail: undefined, picked: undefined }] }, 'only what the view shows');
    assert.equal(await reply(one, [1]), items[1], 'the item itself');
    assert.deepEqual(await reply(p.ui.pickMany(items, { title: 'T' }), [1]), [items[1]]);
    assert.deepEqual(await reply(p.ui.pickMany(items, { title: 'T' }), []), [], 'nothing ticked is not cancelled');
    assert.equal(await reply(p.ui.pickMany(items, { title: 'T' })), undefined);
    assert.equal(await reply(p.ui.pick(items, { title: 'T' }), [7]), undefined, 'an index there is no item for');
  });

  test('no flow waits forever: another question or cancel() ends the open one, and late answers are dropped', async () => {
    const { p, asked } = prompts();
    const first = p.ui.input('one');
    const second = p.ui.input('two');
    assert.equal(await first, undefined);
    p.answer(asked[0].id, 'too late');
    assert.equal(p.open, true, 'the second still waits');
    p.cancel();
    assert.equal(await second, undefined);
    assert.equal(p.open, false);
  });
});
