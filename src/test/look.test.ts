import { describe, test } from 'node:test';
import { strict as assert } from 'assert';

interface LookValue { ws: boolean; eol: boolean; wrap: boolean; iws: boolean; ctx: number | null }
interface Look {
  value: LookValue;
  apply(saved?: Partial<LookValue>): void;
  asked(): number;
  change(which?: string): { reload: boolean };
  accepts(answer: { context?: number; ignoreSpace?: boolean }, checkWhitespace: boolean): boolean;
}
const { createLook, WHOLE_FILE, CONTEXTS }: { createLook(post: (m: unknown) => void): Look; WHOLE_FILE: number; CONTEXTS: number[] } = require('../../media/look.js');

const make = () => {
  const sent: any[] = [];
  return { look: createLook(m => sent.push(m)), sent };
};

describe('createLook', () => {
  test('takes over the look the host kept, in the same object', () => {
    const { look } = make();
    const held = look.value;
    look.apply({ ws: true, ctx: null });
    assert.equal(held.ws, true);
    assert.equal(held.ctx, null);
    look.apply(undefined); // nothing saved yet
    assert.equal(held.ws, true);
  });

  test('the whole file is asked for as a big number', () => {
    const { look } = make();
    look.apply({ ctx: null });
    assert.equal(look.asked(), WHOLE_FILE);
    look.apply({ ctx: 0 });
    assert.equal(look.asked(), 0);
  });

  test('a toggle flips one flag, tells the host, and needs no reload', () => {
    const { look, sent } = make();
    assert.deepEqual(look.change('ws'), { reload: false });
    assert.equal(look.value.ws, true);
    look.change('eol'); look.change('wrap');
    assert.deepEqual([look.value.eol, look.value.wrap], [true, true]);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[0], { type: 'saveLook', look: { ws: true, eol: false, wrap: false, iws: false, ctx: 3 } });
  });

  test('ignoring whitespace needs a reload, both ways', () => {
    const { look } = make();
    assert.deepEqual(look.change('iws'), { reload: true });
    assert.deepEqual(look.change('iws'), { reload: true });
  });

  test('more and less context walk the steps, then stop; more past the last step means the whole file', () => {
    const { look } = make();
    assert.deepEqual(look.change('moreCtx'), { reload: true });
    assert.equal(look.value.ctx, 5);
    for (let i = 0; i < 3; i++) look.change('moreCtx'); // 10, 25, whole file
    assert.equal(look.value.ctx, null);
    look.change('lessCtx');
    assert.equal(look.value.ctx, CONTEXTS[CONTEXTS.length - 1]);
    for (let i = 0; i < 10; i++) look.change('lessCtx');
    assert.equal(look.value.ctx, 0);
  });

  test('"all" switches between the whole file and three lines', () => {
    const { look } = make();
    look.change('allCtx');
    assert.equal(look.value.ctx, null);
    look.change('allCtx');
    assert.equal(look.value.ctx, 3);
  });

  test('an answer for another context is dropped; one without a context always counts', () => {
    const { look } = make();
    assert.equal(look.accepts({}, true), true);
    assert.equal(look.accepts({ context: 3 }, false), true);
    assert.equal(look.accepts({ context: 5 }, false), false);
    look.apply({ ctx: null });
    assert.equal(look.accepts({ context: WHOLE_FILE }, false), true);
  });

  test('whitespace is only compared where the view asks with -w', () => {
    const { look } = make();
    assert.equal(look.accepts({ context: 3, ignoreSpace: true }, false), true);
    assert.equal(look.accepts({ context: 3, ignoreSpace: true }, true), false);
    look.apply({ iws: true });
    assert.equal(look.accepts({ context: 3 }, true), false);
    assert.equal(look.accepts({ context: 3, ignoreSpace: true }, true), true);
  });
});
