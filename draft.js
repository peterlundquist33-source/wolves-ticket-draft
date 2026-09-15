/* Draft rules, pure and testable. No DOM, no Firebase.
 *
 * A draft document looks like:
 *   { participants: ["Peter","Anna","John","Mom & Dad"],   // 4 names
 *     order: [2,0,3,1],          // participant indexes, first-round order
 *     started: true,
 *     picks: [ { game, person, seats: 2|4, ts } ] }
 *
 * Every game has 4 seats = 2 seat-pairs. One pick = one seat-pair. A 4-seat pick
 * takes both pairs at once and costs the picker their NEXT turn too ("spend 2 of
 * your own picks"). A PASS ({pass:true}) gives up one of your seat-pairs for the
 * season: your turn is used, your allotment shrinks by one. Turns run as a snake
 * until every seat-pair is claimed or nobody has picks left. Whatever is left
 * over after that is first-come: anyone can CLAIM ({claim:true}) a free pair.
 */
(function (root) {
  "use strict";

  var SEATS_PER_GAME = 4;
  var PAIRS_PER_GAME = 2;

  function snakeSlot(order, n) {
    // n-th slot (0-based) of an endless snake over `order`
    var k = order.length, round = Math.floor(n / k), i = n % k;
    return order[round % 2 === 0 ? i : k - 1 - i];
  }

  /** Build everything the UI needs from the raw doc + game list. */
  function derive(doc, games) {
    var participants = (doc && doc.participants) || [];
    var order = (doc && doc.order) || [];
    var picks = (doc && doc.picks) || [];
    var totalPairs = games.length * PAIRS_PER_GAME;
    var perPerson = participants.length ? totalPairs / participants.length : 0;

    var claims = {};      // gameId -> [{person, seats, pickNo}]
    var pairsUsed = {};   // person -> seat-pairs used
    participants.forEach(function (_, i) { pairsUsed[i] = 0; });
    games.forEach(function (g) { claims[g.id] = []; });

    // Walk the snake. Each pick consumes the current slot; a 4-seat pick also
    // marks the picker as owing a slot, which swallows their next turn.
    var owed = {}, slot = 0, log = [], slotsWalked = 0;
    participants.forEach(function (_, i) { owed[i] = 0; });
    var passes = {};
    participants.forEach(function (_, i) { passes[i] = 0; });
    var pairsLeft = function (p) { return perPerson - pairsUsed[p] - passes[p]; };
    var claimedPairs = 0, claims_after = 0;

    function advanceToLiveSlot() {
      // skip slots for people who owe a turn or are out of pairs
      var guard = 0;
      while (guard++ < 1000) {
        var p = snakeSlot(order, slot);
        if (owed[p] > 0) { owed[p]--; log.push({ type: "skip", person: p, slot: slot, reason: "used on a 4-seat pick" }); slot++; continue; }
        if (pairsLeft(p) <= 0) { slot++; continue; }
        return p;
      }
      return null;
    }

    var pickNo = 0, valid = true;
    for (var i = 0; i < picks.length; i++) {
      var pk = picks[i];
      if (pk.claim) {
        // post-draft leftovers: no turn, just a free pair
        claims_after++;
        claims[pk.game] && claims[pk.game].push({ person: pk.person, seats: 2, pickNo: 0, claim: true });
        claimedPairs += 1;
        log.push({ type: "claim", person: pk.person, game: pk.game, seats: 2, ts: pk.ts });
        continue;
      }
      var onClock = order.length ? advanceToLiveSlot() : null;
      if (onClock !== pk.person) { valid = false; }
      if (pk.pass) {
        passes[pk.person]++;
        log.push({ type: "pass", person: pk.person, ts: pk.ts, slot: slot });
        slot++;
        continue;
      }
      var pairs = pk.seats === SEATS_PER_GAME ? 2 : 1;
      pickNo++;
      for (var j = 0; j < pairs; j++) claims[pk.game] && claims[pk.game].push({ person: pk.person, seats: 2, pickNo: pickNo });
      pairsUsed[pk.person] += pairs;
      claimedPairs += pairs;
      if (pairs === 2) owed[pk.person] = (owed[pk.person] || 0) + 1;
      log.push({ type: "pick", pickNo: pickNo, person: pk.person, game: pk.game, seats: pk.seats, ts: pk.ts, slot: slot });
      slot++;
    }

    var nobodyLeft = participants.length > 0 && participants.every(function (_, p) { return pairsLeft(p) <= 0; });
    var complete = claimedPairs >= totalPairs || nobodyLeft;
    var onClock = (!complete && doc && doc.started && order.length) ? advanceToLiveSlot() : null;
    if (onClock === null && !complete && doc && doc.started) complete = true;   // nobody can pick
    var round = order.length ? Math.floor(slot / order.length) + 1 : 0;

    // per-game status
    var board = games.map(function (g) {
      var c = claims[g.id];
      var owners = {};
      c.forEach(function (x) { owners[x.person] = (owners[x.person] || 0) + x.seats; });
      var pairsTaken = c.length;
      return {
        game: g,
        pairsTaken: pairsTaken,
        pairsFree: PAIRS_PER_GAME - pairsTaken,
        owners: Object.keys(owners).map(function (p) { return { person: +p, seats: owners[p] }; }),
        status: pairsTaken === 0 ? "open" : pairsTaken < PAIRS_PER_GAME ? "half" : "full"
      };
    });

    var mine = {};
    participants.forEach(function (_, p) {
      mine[p] = board.filter(function (b) { return b.owners.some(function (o) { return o.person === p; }); })
        .map(function (b) { return { game: b.game, seats: b.owners.filter(function (o) { return o.person === p; })[0].seats }; });
    });

    return {
      participants: participants, order: order, started: !!(doc && doc.started),
      picks: picks, log: log, board: board, mine: mine,
      pairsUsed: pairsUsed, passes: passes, perPerson: perPerson, pairsLeft: participants.map(function (_, p) { return pairsLeft(p); }),
      leftoverPairs: totalPairs - claimedPairs,
      onClock: onClock, round: round, pickNo: pickNo + 1, totalPicks: totalPairs,
      claimedPairs: claimedPairs, totalPairs: totalPairs, complete: complete, valid: valid
    };
  }

  /** Why can't `person` take `game` with `seats` right now? null = allowed. */
  function validatePick(state, person, gameId, seats) {
    if (!state.started) return "The draft hasn't started.";
    if (state.complete) return "The draft is over.";
    if (state.onClock !== person) return "It's not your turn.";
    var b = state.board.filter(function (x) { return x.game.id === gameId; })[0];
    if (!b) return "Unknown game.";
    var pairs = seats === SEATS_PER_GAME ? 2 : 1;
    if (b.pairsFree < pairs) return pairs === 2 ? "Both seat-pairs aren't free for that game." : "That game is fully drafted.";
    if (b.owners.some(function (o) { return o.person === person; })) return "You already have seats to that game.";
    if (state.pairsLeft[person] < pairs) return "You don't have enough picks left for that.";
    return null;
  }

  /** Passing: allowed only on your turn. */
  function validatePass(state, person) {
    if (!state.started) return "The draft hasn't started.";
    if (state.complete) return "The draft is over.";
    if (state.onClock !== person) return "It's not your turn.";
    return null;
  }

  /** Claiming a leftover pair after the draft: first come, first served. */
  function validateClaim(state, person, gameId) {
    if (!state.complete) return "Leftovers open up once the draft is over.";
    var b = state.board.filter(function (x) { return x.game.id === gameId; })[0];
    if (!b) return "Unknown game.";
    if (b.pairsFree < 1) return "That game is full.";
    return null;
  }

  function shuffle(n, rand) {
    rand = rand || Math.random;
    var a = []; for (var i = 0; i < n; i++) a.push(i);
    for (var k = a.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)); var t = a[k]; a[k] = a[j]; a[j] = t; }
    return a;
  }

  var api = { derive: derive, validatePick: validatePick, validatePass: validatePass, validateClaim: validateClaim, shuffle: shuffle, snakeSlot: snakeSlot,
              SEATS_PER_GAME: SEATS_PER_GAME, PAIRS_PER_GAME: PAIRS_PER_GAME };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WolvesDraft = api;
})(typeof window !== "undefined" ? window : globalThis);
