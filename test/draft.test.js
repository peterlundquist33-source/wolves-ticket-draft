// node --test test/
const test = require('node:test'); const assert = require('node:assert');
const D = require('../draft.js');
const games = Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, opp: 'Opp' + i }));
const P = ['Peter', 'Anna', 'John', 'Folks'];

test('snake order', () => {
  assert.strictEqual([0,1,2,3,4,5,6,7,8].map(i => D.snakeSlot([2,0,3,1], i)).join(''), '203113022');
});

test("a game's second pair can be taken on a later turn; prices roll up", () => {
  const doc = { participants: P, order: [0,1,2,3], started: true, prices: { g0: 50, g1: 20 },
    picks: [{ game: 'g0', person: 0, seats: 2 }, { game: 'g1', person: 1, seats: 2 }, { game: 'g2', person: 2, seats: 2 }, { game: 'g3', person: 3, seats: 2 },
            { game: 'g0', person: 3, seats: 2 }] };   // snake: 3 picks again and takes g0's other pair
  let s = D.derive(doc, games);
  assert.ok(s.valid);
  assert.strictEqual(s.onClock, 2);
  assert.strictEqual(D.validatePick(s, 2, 'g2', 2), null);   // John already has 2 seats to g2; the other pair is still free
  assert.strictEqual(D.validatePick(s, 2, 'g0', 2), 'That game is fully drafted.');
  assert.strictEqual(s.due[0], 100); assert.strictEqual(s.due[3], 100); assert.strictEqual(s.due[1], 40); assert.strictEqual(s.due[2], 0);
  assert.strictEqual(s.mine[2][0].cost, null);
  assert.ok(s.hasPrices);
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

test('passing shrinks your allotment; leftovers are claimable after the draft', () => {
  const doc = { participants: P, order: [0,1,2,3], started: true, picks: [] };
  let s = D.derive(doc, games);
  assert.strictEqual(D.validatePass(s, 1, ), "It's not your turn.");
  assert.strictEqual(D.validatePass(s, 0), null);
  doc.picks.push({ pass: true, person: 0, ts: 1 });           // Peter passes round 1
  s = D.derive(doc, games);
  assert.strictEqual(s.onClock, 1);
  assert.strictEqual(s.pairsLeft[0], 9);
  assert.strictEqual(s.log[0].type, 'pass');
  // run the rest with 2-seat picks
  let n = 1;
  while (!s.complete) {
    const p = s.onClock;
    const b = s.board.find(b => b.pairsFree > 0 && !b.owners.some(o => o.person === p));
    doc.picks.push({ game: b.game.id, person: p, seats: 2, ts: n++ });
    s = D.derive(doc, games);
  }
  assert.ok(s.complete);
  assert.strictEqual(s.leftoverPairs, 1);
  assert.deepStrictEqual(s.pairsLeft, [0,0,0,0]);
  const open = s.board.find(b => b.pairsFree > 0);
  assert.strictEqual(D.validateClaim(s, 2, open.game.id), null);
  doc.picks.push({ claim: true, game: open.game.id, person: 2, seats: 2, ts: n });
  s = D.derive(doc, games);
  assert.strictEqual(s.leftoverPairs, 0);
  assert.ok(s.valid);
  assert.strictEqual(D.validateClaim(s, 3, open.game.id), 'That game is full.');
});
