// node --test test/
const test = require('node:test'); const assert = require('node:assert');
const D = require('../draft.js');
const games = Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, opp: 'Opp' + i }));
const P = ['Peter', 'Anna', 'John', 'Folks'];

test('snake order', () => {
  assert.strictEqual([0,1,2,3,4,5,6,7,8].map(i => D.snakeSlot([2,0,3,1], i)).join(''), '203113022');
});

test('full draft with one 4-seat pick ends with every pair claimed and the picker skipped once', () => {
  const doc = { participants: P, order: [2,0,3,1], started: true, picks: [] };
  let s = D.derive(doc, games), n = 0;
  while (!s.complete) {
    const p = s.onClock;
    const opts = s.board.filter(b => b.pairsFree > 0 && !b.owners.some(o => o.person === p));
    const seats = n === 1 ? 4 : 2;
    const b = seats === 4 ? opts.find(b => b.pairsFree === 2) : opts[0];
    assert.strictEqual(D.validatePick(s, p, b.game.id, seats), null);
    doc.picks.push({ game: b.game.id, person: p, seats, ts: n });
    s = D.derive(doc, games); n++;
  }
  assert.strictEqual(n, 39);
  assert.ok(s.valid);
  assert.deepStrictEqual(Object.values(s.pairsUsed), [10,10,10,10]);
  const four = s.log.find(l => l.type === 'pick' && l.seats === 4), skip = s.log.find(l => l.type === 'skip');
  assert.strictEqual(skip.person, four.person);
});

test('guards', () => {
  const s = D.derive({ participants: P, order: [0,1,2,3], started: true, picks: [] }, games);
  assert.strictEqual(D.validatePick(s, 1, 'g0', 2), "It's not your turn.");
  assert.match(D.validatePick(D.derive({ participants: P, order: [0,1,2,3], started: false, picks: [] }, games), 0, 'g0', 2), /hasn't started/);
  const half = D.derive({ participants: P, order: [0,1,2,3], started: true, picks: [{ game: 'g0', person: 0, seats: 2 }] }, games);
  assert.match(D.validatePick(half, 1, 'g0', 4), /Both seat-pairs/);
  assert.strictEqual(D.validatePick(half, 1, 'g0', 2), null);
});
