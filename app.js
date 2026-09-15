/* Wolves Family Ticket Draft — UI + Firestore glue. Rules live in draft.js. */
(function () {
  "use strict";
  var D = window.WolvesDraft, GAMES = window.WOLVES_GAMES;
  var DRAFT_PATH = "wolvesdraft/family-2026-27";
  var DEFAULT_NAMES = ["Erik & Sue", "Peter & Nicole", "John & Rachel", "Anna & Duncan"];
  var COLORS = ["#78BE20", "#4fa3e0", "#ffd76a", "#ff8a65"];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };
  var gameById = {}; GAMES.forEach(function (g) { gameById[g.id] = g; });
  var fmtDate = function (iso) { var d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  var fmtTime = function (ts) { return ts ? new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""; };

  // ---------------------------------------------------------------- state
  var db = null, ref = null, doc = null, state = null;
  var me = localStorage.getItem("wolves-draft-me");           // participant index as string, or null
  var lastPickCount = null, wasMyTurn = false, view = "lobby", userPickedView = false;

  try {
    if (window.firebase && window.FIREBASE_CONFIG) { firebase.initializeApp(window.FIREBASE_CONFIG); db = firebase.firestore(); ref = db.doc(DRAFT_PATH); }
  } catch (e) { db = null; }

  function myIndex() { return me === null || me === "" ? null : +me; }
  function name(i) { return (state && state.participants[i]) || DEFAULT_NAMES[i] || "?"; }
  function sw(i) { return '<span class="sw" style="background:' + COLORS[i % 4] + '"></span>'; }

  // ---------------------------------------------------------------- firestore
  function ensureDoc() {
    return ref.get().then(function (snap) {
      if (snap.exists) return;
      return ref.set({ participants: DEFAULT_NAMES.slice(), order: D.shuffle(4), started: false, picks: [], createdAt: Date.now(), updatedAt: Date.now() });
    });
  }

  function subscribe() {
    ref.onSnapshot(function (snap) {
      doc = snap.data() || null;
      if (!doc) { ensureDoc(); return; }
      render();
    }, function (err) { console.error(err); $("lobby-status").textContent = "Can't reach the draft database: " + err.message; });
  }

  function makePick(gameId, seats) {
    var p = myIndex();
    if (p === null) { openWho(); return; }
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = snap.data();
        var s = D.derive(d, GAMES);
        var why = D.validatePick(s, p, gameId, seats);
        if (why) throw new Error(why);
        var picks = (d.picks || []).concat([{ game: gameId, person: p, seats: seats, ts: Date.now() }]);
        tx.update(ref, { picks: picks, updatedAt: Date.now() });
      });
    }).catch(function (e) { alert(e.message || "That pick didn't go through."); });
  }

  function passTurn() {
    var p = myIndex();
    if (p === null) { openWho(); return; }
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = snap.data(), s = D.derive(d, GAMES);
        var why = D.validatePass(s, p);
        if (why) throw new Error(why);
        tx.update(ref, { picks: (d.picks || []).concat([{ pass: true, person: p, ts: Date.now() }]), updatedAt: Date.now() });
      });
    }).catch(function (e) { alert(e.message || "That didn't go through."); });
  }

  function claimLeftover(gameId) {
    var p = myIndex();
    if (p === null) { openWho(); return; }
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var d = snap.data(), s = D.derive(d, GAMES);
        var why = D.validateClaim(s, p, gameId);
        if (why) throw new Error(why);
        tx.update(ref, { picks: (d.picks || []).concat([{ claim: true, game: gameId, person: p, seats: 2, ts: Date.now() }]), updatedAt: Date.now() });
      });
    }).catch(function (e) { alert(e.message || "That didn't go through."); });
  }

  function saveLobby(patch) { patch.updatedAt = Date.now(); return ref.update(patch).catch(function (e) { alert(e.message); }); }

  // ---------------------------------------------------------------- render
  function render() {
    state = D.derive(doc, GAMES);
    var mi = myIndex();

    // auto-view: lobby until started, then board (unless the user chose a tab)
    if (!userPickedView) setView(state.started ? "board" : "lobby", true);

    // scoreboard
    $("sb-round").textContent = state.started ? Math.min(state.round, Math.ceil(state.totalPicks / 4)) : "–";
    $("sb-pick").textContent = state.started ? (state.complete ? "done" : state.pickNo + "/" + state.totalPicks) : "–";
    $("sb-clock").textContent = state.complete ? "Draft over" : state.started && state.onClock !== null ? name(state.onClock) : "Not started";
    $("sb-mid").querySelector(".sb-clock").classList.toggle("blink", state.started && !state.complete && state.onClock === mi);
    $("who-name").textContent = mi === null ? "pick a name" : name(mi);
    var boardTab = document.querySelector('.tabs [data-view="board"]');
    boardTab.innerHTML = "Draft Board" + (state.started && !state.complete && state.onClock === mi ? '<span class="dot"></span>' : "");

    renderLobby(mi);
    renderBoard(mi);
    renderMine(mi);
    renderSeason();
    renderWho();

    // pick reveal for picks that arrived after we loaded
    var n = state.picks.length;
    if (lastPickCount !== null && n > lastPickCount && !state.picks[n - 1].pass && !state.picks[n - 1].claim) {
      var pk = state.picks[n - 1];
      showReveal(state.log.filter(function (l) { return l.type === "pick"; }).length, pk);
      var card = document.querySelector('.gcard[data-game="' + pk.game + '"]');
      if (card) { card.classList.add("just"); setTimeout(function () { card.classList.remove("just"); }, 800); }
    }
    lastPickCount = n;

    // your turn!
    var myTurn = state.started && !state.complete && state.onClock === mi;
    if (myTurn && !wasMyTurn) nudge();
    wasMyTurn = myTurn;
    document.title = (myTurn ? "🟢 YOUR PICK · " : "") + "Wolves Family Ticket Draft";
  }

  function renderLobby(mi) {
    var ol = $("order-list"); ol.innerHTML = "";
    state.order.forEach(function (p, i) {
      var li = document.createElement("li");
      li.className = p === mi ? "me" : "";
      li.innerHTML = '<span class="num">' + (i + 1) + "</span>" + sw(p) + '<span class="name">' + esc(name(p)) + "</span>" +
        '<span class="tag">' + (i === 0 ? "FIRST PICK" : i === state.order.length - 1 ? "SNAKE TURN" : "") + "</span>" +
        (state.started ? "" : '<span class="move"><button type="button" data-move="-1" data-i="' + i + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>▲</button>' +
          '<button type="button" data-move="1" data-i="' + i + '" aria-label="Move down"' + (i === state.order.length - 1 ? " disabled" : "") + '>▼</button></span>');
      ol.appendChild(li);
    });
    $("lobby-who").innerHTML = state.participants.map(function (nm, i) {
      return '<span class="chip' + (i === mi ? " me" : "") + '">' + sw(i) + esc(nm) + "</span>";
    }).join("");
    var started = state.started;
    $("edit-names").disabled = started; $("shuffle-btn").disabled = started; $("start-btn").disabled = started; $("set-order-btn").disabled = started;
    $("start-btn").textContent = started ? (state.complete ? "Draft complete" : "Draft in progress") : "Start the draft";
    $("lobby-status").textContent = started
      ? (state.complete ? "All " + state.totalPairs + " seat-pairs are drafted. See the Season tab." : "Live. " + name(state.onClock) + " is on the clock.")
      : "Not started. " + name(state.order[0]) + " picks first.";
  }

  function renderBoard(mi) {
    var banner = $("turn-banner");
    if (!state.started) {
      banner.className = "turn-banner"; banner.innerHTML = '<span class="big">Waiting on the lobby.</span><span>Start the draft from the Lobby tab.</span>';
    } else if (state.complete) {
      banner.className = "turn-banner";
      banner.innerHTML = state.leftoverPairs > 0
        ? '<span class="big">DRAFT\'S DONE. ' + state.leftoverPairs + " PAIR" + (state.leftoverPairs === 1 ? "" : "S") + ' OF SEATS LEFT OVER.</span><span>Somebody passed, so these are first come, first served. Anyone can grab them below.</span>'
        : '<span class="big">That\'s the draft.</span><span>Every seat is spoken for. Check the Season tab.</span>';
    } else {
      var oc = state.onClock, mine = oc === mi;
      banner.className = "turn-banner" + (mine ? " mine" : "");
      banner.innerHTML = '<span class="big">' + (mine ? "YOU'RE ON THE CLOCK" : esc(name(oc)).toUpperCase() + " IS ON THE CLOCK") + "</span>" +
        "<span>Round " + state.round + " · Pick " + state.pickNo + " of " + state.totalPicks + "</span>" +
        '<span class="sp">' + (mi === null ? "Pick your name (top right) to draft." : name(mi) + ": " + state.pairsLeft[mi] + " pick" + (state.pairsLeft[mi] === 1 ? "" : "s") + " left") + "</span>" +
        (mine ? '<button class="btn ghost pass-btn" id="pass-btn" type="button" title="Give up this pick. You end the season with one fewer pair of seats.">Pass this pick</button>' : "");
    }

    var hideFull = $("hide-full").checked;
    var grid = $("grid"); grid.innerHTML = "";
    state.board.forEach(function (b) {
      if (hideFull && b.status === "full") return;
      var g = b.game, canPick = state.started && !state.complete && state.onClock === mi;
      var can2 = canPick && !D.validatePick(state, mi, g.id, 2);
      var can4 = canPick && !D.validatePick(state, mi, g.id, 4);
      var card = document.createElement("article");
      card.className = "gcard " + b.status + (can2 ? " pickable" : "");
      card.dataset.game = g.id;
      card.innerHTML =
        '<div class="g-top"><div class="g-date">' + fmtDate(g.date).toUpperCase() + "<small>" + esc(g.time) + " CT</small></div>" +
        '<span class="pill ' + b.status + '">' + (b.status === "open" ? "Open" : b.status === "half" ? "2 seats left" : "Full") + "</span></div>" +
        '<div class="g-opp"><span class="abbr">' + esc(g.abbr) + "</span>" + esc(g.opp) + "</div>" +
        (g.note ? '<div class="g-note">' + esc(g.note) + "</div>" : "") +
        '<div class="g-owners">' + b.owners.map(function (o) { return '<span class="chip">' + sw(o.person) + esc(name(o.person)) + " · " + o.seats + " seats</span>"; }).join("") + "</div>" +
        (canPick && b.status !== "full" ? '<div class="g-actions">' +
          '<button class="btn primary" data-pick="2" ' + (can2 ? "" : "disabled") + ">Draft 2 seats</button>" +
          (b.status === "open" ? '<button class="btn ghost" data-pick="4" ' + (can4 ? "" : "disabled") + ' title="Uses this pick and your next one">All 4 seats</button>' : "") +
          "</div>" : "") +
        (state.complete && b.status !== "full" ? '<div class="g-actions"><button class="btn primary" data-claim="1">Claim 2 leftover seats</button></div>' : "");
      grid.appendChild(card);
    });

    var log = $("log"); log.innerHTML = "";
    state.log.slice().reverse().forEach(function (l) {
      var li = document.createElement("li");
      if (l.type === "skip") { li.className = "skip"; li.innerHTML = '<span class="n">–</span><span>' + esc(name(l.person)) + " sits this turn (" + esc(l.reason) + ")</span><span></span>"; }
      else if (l.type === "pass") { li.className = "skip"; li.innerHTML = '<span class="n">–</span><span>' + sw(l.person) + "<b>" + esc(name(l.person)) + "</b> passes, one fewer pair of seats for them this season</span><time>" + fmtTime(l.ts) + "</time>"; }
      else if (l.type === "claim") { var cg = gameById[l.game]; li.innerHTML = '<span class="n">+</span><span>' + sw(l.person) + "<b>" + esc(name(l.person)) + "</b> claims leftover seats to <b>" + esc(cg ? cg.abbr + " · " + fmtDate(cg.date) : l.game) + "</b> (2 seats)</span><time>" + fmtTime(l.ts) + "</time>"; }
      else { var g = gameById[l.game]; li.innerHTML = '<span class="n">#' + l.pickNo + "</span><span>" + sw(l.person) + "<b>" + esc(name(l.person)) + "</b> takes <b>" + esc(g ? g.abbr + " · " + fmtDate(g.date) : l.game) + "</b> (" + l.seats + " seats)</span><time>" + fmtTime(l.ts) + "</time>"; }
      log.appendChild(li);
    });
    if (!state.log.length) log.innerHTML = '<li><span class="n">–</span><span class="muted">No picks yet.</span><span></span></li>';
  }

  function renderMine(mi) {
    $("mine-title").textContent = mi === null ? "My games" : name(mi) + "'s games";
    var list = $("mine-list"); list.innerHTML = "";
    if (mi === null) { $("mine-sub").textContent = "Pick your name up top to see your haul."; }
    else {
      var games = state.mine[mi] || [];
      var seats = games.reduce(function (a, x) { return a + x.seats; }, 0);
      $("mine-sub").textContent = games.length + " game" + (games.length === 1 ? "" : "s") + ", " + seats + " seats" + (state.complete ? "." : ", " + state.pairsLeft[mi] + " pick" + (state.pairsLeft[mi] === 1 ? "" : "s") + " still to make.");
      games.forEach(function (x) {
        var t = document.createElement("div"); t.className = "ticket";
        t.innerHTML = '<div class="t-date">' + fmtDate(x.game.date).toUpperCase() + " · " + esc(x.game.time) + '</div><div class="t-opp">vs ' + esc(x.game.opp) + "</div>" + (x.game.note ? '<div class="small" style="color:#556">' + esc(x.game.note) + "</div>" : "") + '<div class="t-seats">' + x.seats + " SEATS</div>";
        list.appendChild(t);
      });
      if (!games.length) list.innerHTML = '<p class="muted">Nothing yet. Go draft.</p>';
    }
    var haul = $("haul"); haul.innerHTML = "";
    state.participants.forEach(function (nm, i) {
      var used = state.pairsUsed[i], pct = state.perPerson ? Math.round(100 * used / state.perPerson) : 0;
      var g = state.mine[i] || [];
      var h = document.createElement("div"); h.className = "h";
      h.innerHTML = "<b>" + sw(i) + " " + esc(nm) + '</b><div class="bar"><i style="width:' + pct + '%;background:' + COLORS[i % 4] + '"></i></div><small>' + g.length + " games · " + used * 2 + " seats · " + Math.max(0, state.pairsLeft[i]) + " picks left" + (state.passes[i] ? " · passed " + state.passes[i] : "") + "</small>";
      haul.appendChild(h);
    });
  }

  function renderSeason() {
    $("season-sub").textContent = state.complete ? "Final. Every game, who's going, how many seats." : "Live view. Fills in as the draft goes.";
    var t = $("season-table");
    t.innerHTML = "<tr><th>Date</th><th>Opponent</th><th>Who's going</th></tr>" + state.board.map(function (b) {
      var who = b.owners.length ? b.owners.map(function (o) { return '<span class="chip">' + sw(o.person) + esc(name(o.person)) + " · " + o.seats + "</span>"; }).join(" ") : '<span class="muted">—</span>';
      return '<tr><td class="d">' + fmtDate(b.game.date).toUpperCase() + "<br><small style=\"color:#9EA2A2;font-family:Inter\">" + esc(b.game.time) + "</small></td><td><b>" + esc(b.game.opp) + "</b>" + (b.game.note ? '<br><small class="muted">' + esc(b.game.note) + "</small>" : "") + "</td><td>" + who + "</td></tr>";
    }).join("");
  }

  function renderWho() {
    $("who-grid").innerHTML = state.participants.map(function (nm, i) {
      return '<button type="button" data-me="' + i + '">' + sw(i) + " " + esc(nm) + "</button>";
    }).join("");
  }

  // ---------------------------------------------------------------- reveal + nudge
  var revealTimer = null;
  function showReveal(pickNo, pk) {
    var g = gameById[pk.game];
    $("reveal-kicker").textContent = "PICK #" + pickNo;
    $("reveal-who").textContent = name(pk.person);
    $("reveal-what").textContent = pk.seats === 4 ? "takes the whole row" : "selects";
    $("reveal-game").textContent = g ? g.opp + " · " + fmtDate(g.date) : pk.game;
    $("reveal-seats").textContent = pk.seats + " SEATS";
    var r = $("reveal"); r.classList.add("show");
    clearTimeout(revealTimer); revealTimer = setTimeout(function () { r.classList.remove("show"); }, 2600);
  }
  $("reveal").addEventListener("click", function () { $("reveal").classList.remove("show"); });

  function nudge() {
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach(function (t, i) { var o = ctx.createOscillator(), gn = ctx.createGain(); o.frequency.value = i ? 880 : 660; o.connect(gn); gn.connect(ctx.destination); gn.gain.setValueAtTime(.001, ctx.currentTime + t); gn.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + t + .02); gn.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .22); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .25); });
    } catch (e) {}
    try { if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification("You're on the clock", { body: "Wolves draft: make your pick." }); } catch (e) {}
    if (!userPickedView) setView("board", true);
  }

  // ---------------------------------------------------------------- views + events
  function setView(v, auto) {
    view = v; if (!auto) userPickedView = true;
    document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === v); });
    document.querySelectorAll(".view").forEach(function (s) { s.classList.toggle("active", s.id === "view-" + v); });
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });

  function openWho() { $("who-modal").classList.add("show"); }
  $("who-btn").addEventListener("click", openWho);
  $("who-grid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-me]"); if (!b) return;
    me = b.dataset.me; localStorage.setItem("wolves-draft-me", me);
    $("who-modal").classList.remove("show");
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (err) {}
    wasMyTurn = false; render();
  });

  $("grid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pick]"); if (!b) return;
    var gameId = b.closest(".gcard").dataset.game, seats = +b.dataset.pick, g = gameById[gameId];
    var msg = seats === 4 ? "Take ALL 4 seats to " + g.opp + " on " + fmtDate(g.date) + "? This uses this pick and your next one." : "Draft 2 seats to " + g.opp + " on " + fmtDate(g.date) + "?";
    if (confirm(msg)) makePick(gameId, seats);
  });
  $("grid").addEventListener("click", function (e) {
    var b = e.target.closest("[data-claim]"); if (!b) return;
    var gameId = b.closest(".gcard").dataset.game, g = gameById[gameId];
    if (confirm("Claim 2 leftover seats to " + g.opp + " on " + fmtDate(g.date) + "?")) claimLeftover(gameId);
  });
  $("turn-banner").addEventListener("click", function (e) {
    if (!e.target.closest("#pass-btn")) return;
    var mi = myIndex(); if (mi === null) return;
    var left = state.pairsLeft[mi];
    if (confirm("Pass this pick? You give up one pair of seats for the season: " + (left - 1) + " pick" + (left - 1 === 1 ? "" : "s") + " left instead of " + left + ". Whatever's unclaimed at the end is first come, first served.")) passTurn();
  });
  $("hide-full").addEventListener("change", function () { render(); });

  $("edit-names").addEventListener("click", function () {
    var names = state.participants.map(function (nm, i) { var v = prompt("Name for drafter " + (i + 1) + ":", nm); return v === null ? nm : (v.trim() || nm); });
    saveLobby({ participants: names });
  });
  $("shuffle-btn").addEventListener("click", function () { saveLobby({ order: D.shuffle(4) }); });
  // manual order: arrows on each row, or type it out
  $("order-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-move]"); if (!b || state.started) return;
    var i = +b.dataset.i, j = i + (+b.dataset.move), o = state.order.slice();
    if (j < 0 || j >= o.length) return;
    var t = o[i]; o[i] = o[j]; o[j] = t;
    saveLobby({ order: o });
  });
  $("set-order-btn").addEventListener("click", function () {
    var legend = state.participants.map(function (n, i) { return (i + 1) + " = " + n; }).join("\n");
    var v = prompt("Type the pick order as numbers, first to last:\n" + legend + "\n\nExample: 3,1,4,2", state.order.map(function (p) { return p + 1; }).join(","));
    if (v === null) return;
    var o = v.split(/[^0-9]+/).filter(Boolean).map(function (x) { return +x - 1; });
    var ok = o.length === 4 && o.slice().sort().join(",") === "0,1,2,3";
    if (!ok) { alert("Need each of 1, 2, 3, 4 exactly once, like 3,1,4,2."); return; }
    saveLobby({ order: o });
  });
  $("start-btn").addEventListener("click", function () {
    if (state.participants.some(function (n) { return /^Person \d$/.test(n); }) && !confirm("Some names are still placeholders. Start anyway?")) return;
    if (confirm("Start the draft? Names and order lock once it starts.")) saveLobby({ started: true, startedAt: Date.now() });
  });
  $("reset-btn").addEventListener("click", function () {
    if (prompt('This wipes every pick for everyone. Type RESET to confirm.') !== "RESET") return;
    saveLobby({ picks: [], started: false, order: D.shuffle(4), resetAt: Date.now() });
  });

  // ---------------------------------------------------------------- boot
  if (!db) {
    $("lobby-status").textContent = "Can't load the draft database. Check your connection and reload.";
    state = D.derive({ participants: DEFAULT_NAMES, order: [0, 1, 2, 3], started: false, picks: [] }, GAMES); renderWho();
  } else {
    ensureDoc().then(subscribe).catch(function (e) { $("lobby-status").textContent = "Database error: " + e.message; });
  }
  if (me === null) setTimeout(openWho, 400);
})();
