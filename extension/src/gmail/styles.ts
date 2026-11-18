/**
 * "Wave" design — bold cards with a hard blue shadow, a big name and a living voice wave.
 * Blue / white / black. Scoped inside the Shadow DOM so Gmail's CSS never leaks in (or out).
 * Edit the tokens in :host to re-theme everything (see design/vaani-wave-design.html).
 */
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:host {
  --ink: #030a18; --panel: #0b1830; --panel2: #0f2244; --line: #20406e; --line2: #2f5288;
  --blue: #2a6bff; --sky: #5fd0ff; --white: #f4f8ff; --dim: #8fa8c8; --ok: #7fe0a0; --alert: #ff7a8a;
  --shadow: 10px 10px 0 var(--blue); --shadow-sm: 6px 6px 0 var(--blue);
  --r: 20px; --r-sm: 12px;
  --f-display: VSora, "Segoe UI", sans-serif; --f-text: VGrotesk, "Segoe UI", sans-serif; --f-mono: VMono, ui-monospace, monospace;
  font-family: var(--f-text); color: var(--white);
}
.overlay, .micwrap, .toast, #toast { color: var(--white); font-family: var(--f-text); font-size: 16px; line-height: 1.35; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; text-align: inherit; }
.mono { font-family: var(--f-mono); letter-spacing: .12em; text-transform: uppercase; }
.pa { pointer-events: auto; }

/* ---------- the layer on top of Gmail ---------- */
.overlay { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .25s ease; }
.overlay.open { opacity: 1; }
.overlay .bg { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(2,6,16,.84), rgba(2,8,22,.9)); backdrop-filter: blur(7px) saturate(1.05); }
.overlay .bg::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: min(700px, 52vw); background: linear-gradient(90deg, rgba(11,24,48,.9), rgba(11,24,48,0)); }
.overlay.full .bg { background: rgba(2,7,18,.93); }
.edge { display: none; }

/* what you said (top-left) + close (top-right) */
.cmd { position: absolute; top: 28px; left: 44px; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 260px); white-space: nowrap; }
.cmd .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sky); box-shadow: 0 0 12px var(--sky); flex: none; animation: blink 2s ease-in-out infinite; }
.cmd .lbl { display: none; }
.cmd .q { font: 600 22px var(--f-display); overflow: hidden; text-overflow: ellipsis; letter-spacing: -.01em; }
.cmd .count { font: 500 11px var(--f-mono); letter-spacing: .14em; color: var(--dim); padding-left: 14px; border-left: 1.5px solid var(--line2); }
.closeX { position: absolute; top: 24px; right: 30px; padding: 10px 14px; border-radius: var(--r-sm); border: 1.5px solid var(--line2); font: 500 12px var(--f-mono); letter-spacing: .14em; color: #c9d8ec; }
.closeX::after { content: " ESC · CLOSE"; } .closeX:hover { border-color: var(--white); color: var(--white); }

/* card list (left) */
.stack { position: absolute; left: 44px; top: 86px; width: min(470px, 37vw); bottom: 130px; overflow-y: auto; overflow-x: hidden; padding: 0 14px 14px 0; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.stack-h { display: flex; justify-content: space-between; font-size: 11px; color: var(--sky); margin: 0 0 14px; }
.stack-h b { font-weight: 500; color: var(--dim); }
.timeline { display: none; }
.hc { position: relative; display: block; width: 100%; margin: 0 0 14px; padding: 15px 18px 15px 22px; text-align: left; cursor: pointer;
  background: var(--panel); border: 1.5px solid var(--line); border-radius: 16px; animation: cardIn .4s ease-out both; transition: transform .15s, box-shadow .15s, border-color .15s; }
.hc:hover { border-color: var(--line2); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--line2); }
.hc .top { display: flex; align-items: center; gap: 10px; }
.hc .idx { font-size: 11px; color: var(--dim); }
.hc .time { margin-left: auto; font-size: 11px; color: var(--dim); }
.hc .co { font: 700 21px var(--f-display); margin-top: 8px; line-height: 1.15; letter-spacing: -.01em; }
.hc .sum { font-size: 16px; color: #d6e4f7; margin-top: 4px; line-height: 1.4; }
.hc .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; padding: 4px 8px; border-radius: 7px; border: 1.5px solid var(--line2); color: #bfe0ff; }
.chip.hot { border-color: var(--white); color: var(--white); background: rgba(255,255,255,.08); }
.hc.done { opacity: .55; } .hc.done .sum, .hc.done .meta { display: none; }
.hc.now { border-color: var(--white); box-shadow: var(--shadow-sm); transform: translate(-3px, -3px); }
.hc.now::before { content: ""; position: absolute; left: 0; top: 16px; bottom: 16px; width: 5px; border-radius: 0 5px 5px 0; background: var(--white); }
.speaking { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--sky); }
.hc.incoming { animation: none; opacity: .28; filter: blur(1px); }

.tag { font: 700 11px var(--f-text); letter-spacing: .12em; text-transform: uppercase; padding: 5px 10px; border-radius: 8px; white-space: nowrap; }
.t-white { background: var(--white); color: var(--ink); } .t-blue { background: var(--blue); color: #fff; }
.t-cy { background: var(--sky); color: var(--ink); } .t-cy2 { background: var(--panel2); color: var(--sky); border: 1.5px solid var(--line2); }
.t-dim { background: transparent; color: var(--dim); border: 1.5px solid var(--line2); } .t-alert { background: var(--alert); color: var(--ink); }

/* the name + voice wave (centre right) */
.core { position: absolute; left: calc(min(470px, 37vw) + 60px); right: 40px; top: 15%; height: 38%; pointer-events: none; }
.core .nm { position: absolute; left: 0; right: 0; top: 0; text-align: center; }
.core .nm b { display: block; font: 700 clamp(40px, 4.6vw, 70px) var(--f-display); letter-spacing: -.03em; line-height: 1; }
.core .nm small { display: block; font: 500 12px var(--f-mono); letter-spacing: .26em; color: var(--sky); margin-top: 12px; text-transform: uppercase; }
.ribbon { position: absolute; left: 0; right: 0; bottom: 0; height: 58%; overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.ribbon svg { position: absolute; left: 0; top: 0; width: 200%; height: 100%; animation: flow 9s linear infinite; transform-origin: center; }
.ribbon svg:nth-child(2) { animation-duration: 13s; animation-direction: reverse; opacity: .7; }
.ribbon .amp { transform-origin: 50% 50%; transform: scaleY(.45); transition: transform .5s ease; }
.core.busy .ribbon svg { animation-duration: 3.2s; } .core.busy .ribbon svg:nth-child(2) { animation-duration: 4.6s; }
.core.busy .ribbon .amp { transform: scaleY(1); }

.subtitle { position: absolute; left: calc(min(470px, 37vw) + 80px); right: 60px; top: 58%; text-align: center; }
.subtitle .who { display: none; }
.subtitle p { font: 500 clamp(19px, 1.9vw, 28px) var(--f-text); line-height: 1.38; }
.subtitle .rest { opacity: .38; transition: opacity .15s; } .subtitle .said { opacity: 1; }
.ccbtn { position: absolute; top: 24px; right: 210px; padding: 10px 12px; border-radius: var(--r-sm); border: 1.5px solid var(--line2); font: 500 12px var(--f-mono); letter-spacing: .12em; color: var(--dim); }
.ccbtn b { font-weight: 700; color: var(--dim); } .ccbtn.on { border-color: var(--sky); color: var(--white); } .ccbtn.on b { color: var(--sky); }
.ccbtn:hover { border-color: var(--white); }
.subtitle mark { background: none; color: var(--sky); border-bottom: 3px solid var(--blue); }

/* next to a big panel: keep the name, wave and words clear of it */
.overlay.wide .core, .overlay.wide .hints { left: calc(min(680px, 52vw) + 70px); }
.overlay.wide .subtitle { left: calc(min(680px, 52vw) + 90px); }
.readouts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
.ro { padding: 8px 10px; border-radius: var(--r-sm); border: 1.5px solid var(--line); background: var(--panel); min-width: 0; }
.ro .v { font: 700 20px var(--f-display); line-height: 1.1; } .ro .k { font-size: 9px; color: var(--dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ro.alert { border-color: var(--alert); } .ro.alert .v { color: var(--alert); }

.hints { position: absolute; left: calc(min(470px, 37vw) + 60px); right: 40px; bottom: 30px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; align-items: center; }
.hints .k { font-size: 11px; color: var(--dim); }
.hint { font-size: 15px; padding: 9px 15px; border-radius: var(--r-sm); background: var(--panel); border: 1.5px solid var(--line); }
.hint b { color: var(--sky); font-weight: 600; } .hint:hover { border-color: var(--white); }

/* big panels: one email, confirm, setup, reply, compose, voice */
.focus, .confirm { position: absolute; left: 44px; top: 86px; width: min(600px, 46vw); padding: 28px 30px 28px 34px; background: var(--panel); border: 1.5px solid var(--line2);
  border-radius: var(--r); box-shadow: var(--shadow); animation: cardIn .35s ease-out both; }
.focus::before, .confirm::before { content: ""; position: absolute; left: 0; top: 26px; width: 6px; height: 46px; border-radius: 0 6px 6px 0; background: var(--white); }
.focus .big, .confirm .big { font: 700 clamp(30px, 3.2vw, 46px) var(--f-display); letter-spacing: -.03em; margin-top: 14px; line-height: 1.05; overflow-wrap: anywhere; }
.focus .subj { font-size: 18px; color: var(--dim); margin-top: 6px; }
.focus .sumbig, .confirm .sumbig { font-size: 21px; font-weight: 500; margin-top: 14px; line-height: 1.45; color: #e8f1ff; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
.cell { padding: 10px 14px; border-radius: var(--r-sm); border: 1.5px solid var(--line); background: var(--panel2); }
.cell.hot { border-color: var(--white); }
.cell .k { font-size: 10px; color: var(--dim); } .cell .v { font: 700 19px var(--f-display); margin-top: 3px; }
.conf { margin-top: 16px; display: flex; align-items: center; gap: 12px; font-size: 11px; color: #bfe0ff; }
.bar { flex: 1; height: 8px; border-radius: 9px; background: var(--panel2); position: relative; overflow: hidden; }
.bar i { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 9px; background: linear-gradient(90deg, var(--blue), var(--sky)); }
.acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.btn { font: 700 15px var(--f-text); padding: 11px 18px; border-radius: var(--r-sm); border: 1.5px solid var(--line2); color: var(--white); white-space: nowrap; transition: transform .12s, box-shadow .12s, border-color .12s; text-decoration: none; display: inline-block; }
.btn:hover { border-color: var(--white); transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--blue); }
.btn.solid { background: var(--white); color: var(--ink); border-color: var(--white); }
.btn.ghost { border-color: var(--line); color: var(--dim); }
.btn.alert { background: var(--alert); color: var(--ink); border-color: var(--alert); }
.btn:disabled, .btn[disabled] { opacity: .4; cursor: not-allowed; transform: none; box-shadow: none; }
.btn.sm { font-size: 12.5px; padding: 6px 11px; }

/* full window */
.fullhead { position: absolute; top: 86px; left: 44px; right: 44px; display: flex; gap: 12px; }
.stat { flex: 1; padding: 12px 18px; border-radius: 16px; border: 1.5px solid var(--line); background: var(--panel); }
.stat .k { font-size: 10px; color: var(--dim); } .stat .v { font: 700 30px var(--f-display); margin-top: 4px; }
.cols { position: absolute; top: 190px; left: 44px; right: 44px; bottom: 100px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; overflow-y: auto; padding-right: 6px; }
.col h3 { font: 500 11px var(--f-mono); letter-spacing: .16em; color: var(--sky); padding-bottom: 10px; border-bottom: 1.5px solid var(--line); margin-bottom: 14px; display: flex; justify-content: space-between; text-transform: uppercase; }
.col h3.alert { color: var(--alert); border-color: rgba(255,122,138,.5); }

/* confirm / lists inside panels */
.confirm ul { list-style: none; margin-top: 14px; display: grid; gap: 6px; }
.confirm li { font-size: 16px; padding: 8px 12px; border-radius: 10px; background: var(--panel2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.confirm li b { color: var(--sky); }
.confirm .say { margin-top: 16px; font-size: 18px; } .confirm .say b { color: var(--sky); }
.confirm .k { font-size: 11px; letter-spacing: .14em; color: var(--dim); }

/* setup */
.confirm.setup { width: min(680px, 52vw); max-height: calc(100vh - 190px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.wiz { list-style: none; margin-top: 10px; display: grid; gap: 8px; }
.wiz li { display: flex; gap: 10px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--panel2); white-space: normal; overflow: visible; text-overflow: clip; font-size: 15px; }
.wiz li > div { min-width: 0; flex: 1; }
.wiz .sn { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; background: var(--blue); color: #fff; font: 700 12px var(--f-mono); }
.wiz b { color: var(--white); } .wiz p { margin-top: 2px !important; font-size: 15px !important; }
.wiz code { display: inline-block; margin: 4px 0; padding: 3px 7px; border-radius: 6px; background: var(--ink); border: 1.5px solid var(--line); color: var(--sky); font: 12px var(--f-mono); word-break: break-all; }
.wiz .acts { margin-top: 8px; gap: 6px; }
.tiny { font-size: 13px !important; margin-top: 6px !important; }
.step { display: flex; gap: 14px; margin-top: 16px; padding-top: 16px; border-top: 1.5px solid var(--line); }
.step .num { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 9px; border: 1.5px solid var(--line2); color: var(--sky); font: 700 14px var(--f-display); }
.step.done .num { background: var(--white); border-color: var(--white); color: var(--ink); }
.step .st { font: 700 19px var(--f-display); letter-spacing: -.01em; }
.step p { font-size: 16px; color: var(--dim); margin-top: 4px; line-height: 1.45; }
.step p b { color: var(--white); }
.step a, .lnk { color: var(--sky); font-weight: 700; text-decoration: none; } .lnk { margin-left: 8px; }
.step .acts { margin-top: 10px; }
.keyform { display: flex; gap: 8px; margin-top: 10px; }
.keyform input, .field input { flex: 1; min-width: 0; border-radius: var(--r-sm); background: var(--ink); border: 1.5px solid var(--line2); color: var(--white); font: 500 15px var(--f-text); padding: 10px 13px; outline: none; }
.keyform input[type=password] { font-family: var(--f-mono); }
.keyform input:focus, .field input:focus { border-color: var(--sky); box-shadow: 0 0 0 3px rgba(95,208,255,.18); }
.confirm p.warn, .step p.warn { color: #ffb8c2; margin-top: 12px; font-size: 16px; } .confirm p.ok { color: var(--ok); margin-top: 12px; font-size: 16px; }
.hint2 { margin-top: 10px; font-size: 16px; color: var(--dim); } .hint2 b { color: var(--sky); }
.names { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.names .btn { font-size: 14px; padding: 7px 12px; }

/* reply / compose */
.confirm.reply, .confirm.draft, .confirm.compose { width: min(640px, 48vw); max-height: calc(100vh - 190px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.rto { display: flex; gap: 10px; align-items: center; margin-top: 10px; font-size: 16px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rto .k { width: 64px; flex: none; }
.field { display: flex; gap: 10px; align-items: center; margin-top: 10px; } .field .k { width: 64px; flex: none; }
.dim { color: var(--dim); font-size: 14px; }
.ideas { display: grid; gap: 8px; margin-top: 10px; }
.ideas .btn { text-align: left; font-weight: 600; white-space: normal; }
.ideas .btn .mono { color: var(--sky); margin-right: 8px; }
.confirm textarea { display: block; width: 100%; min-height: 190px; margin-top: 12px; resize: vertical; border-radius: var(--r-sm); background: var(--ink); border: 1.5px solid var(--line2);
  color: var(--white); font: 500 16px/1.55 var(--f-text); padding: 14px 16px; outline: none; }
.confirm textarea:focus { border-color: var(--sky); box-shadow: 0 0 0 3px rgba(95,208,255,.18); }
.confirm textarea[readonly] { opacity: .7; }
.confirm .say.warn { color: #ffd2a8; } .confirm .say.big2 { font-size: 22px; } .confirm .say.big2 b { font: 700 28px var(--f-display); }
.confirm.draft li, .confirm.reply li { white-space: normal; }

/* stats (SQLite history) */
.confirm.statsp { width: min(640px, 48vw); max-height: calc(100vh - 190px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
.grid3 .cell .v { font-size: 30px; }
.months { display: flex; gap: 12px; align-items: flex-end; height: 120px; margin-top: 12px; }
.mo { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
.mo .col { position: relative; flex: 1; width: 100%; max-width: 46px; border-radius: 8px; background: var(--panel2); overflow: hidden; }
.mo .col i, .mo .col b { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 8px; }
.mo .col i { background: rgba(244,248,255,.85); } .mo .col b { background: var(--blue); }
.mo span { font-size: 10px; color: var(--dim); }
/* voice picker */
.vlist { margin-top: 12px; display: grid; gap: 6px; max-height: 40vh; overflow-y: auto; padding-right: 4px; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.vopt { all: unset; box-sizing: border-box; display: flex; justify-content: space-between; gap: 12px; align-items: center; cursor: pointer; padding: 10px 14px; border-radius: var(--r-sm);
  border: 1.5px solid var(--line); background: var(--panel2); font: 600 16px var(--f-text); color: var(--white); }
.vopt:hover { border-color: var(--line2); }
.vopt.on { border-color: var(--white); box-shadow: 4px 4px 0 var(--blue); }
.vopt .mono { font-size: 11px; color: var(--sky); flex: none; }
.rng { display: flex; align-items: center; gap: 12px; margin-top: 14px; font-size: 16px; }
.rng input { flex: 1; accent-color: #5fd0ff; }
.rng .mono { width: 56px; text-align: right; font-size: 12px; color: var(--sky); }

/* ---------- the pill in the corner (no mic icon: a small living wave) ---------- */
.micwrap { position: fixed; left: 22px; bottom: 22px; pointer-events: auto; }
.micbox { display: flex; align-items: center; gap: 12px; padding: 11px 20px 11px 14px; border-radius: 18px; background: #06122a; border: 1.5px solid var(--blue);
  box-shadow: 6px 6px 0 var(--blue), 0 12px 30px rgba(0,0,0,.35); transition: transform .15s, box-shadow .15s; }
.micbox:hover { transform: translate(-1px, -1px); box-shadow: 7px 7px 0 var(--blue), 0 12px 30px rgba(0,0,0,.35); }
.micbox.bad { border-color: var(--alert); box-shadow: 6px 6px 0 var(--alert); }
.micbox .wv { width: 56px; height: 30px; flex: none; overflow: hidden; position: relative; }
.micbox .wv svg { position: absolute; left: 0; top: 0; width: 200%; height: 100%; animation: flow 5s linear infinite; }
.micbox .wv .amp { transform-origin: 50% 50%; transform: scaleY(.35); transition: transform .3s; }
.micbox.live .wv svg { animation-duration: 1.6s; } .micbox.live .wv .amp { transform: scaleY(1); }
.micbox.off .wv { opacity: .4; } .micbox.off .wv svg { animation: none; }
.micbox .t b { font: 700 17px var(--f-display); letter-spacing: -.01em; display: block; line-height: 1.1; }
.micbox .t small { font: 500 10px var(--f-mono); letter-spacing: .14em; color: var(--ok); display: flex; align-items: center; gap: 6px; margin-top: 4px; text-transform: uppercase; }
.micbox .t small i { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
.micbox .t small i.live { background: var(--ok); box-shadow: 0 0 8px var(--ok); animation: blink 1.8s ease-in-out infinite; }
.micbox .t small i.bad { background: var(--alert); } .micbox.bad .t small { color: var(--alert); }
.eqs { display: inline-flex; gap: 2px; align-items: flex-end; height: 16px; }
.eqs i { width: 3px; height: 100%; border-radius: 2px; background: var(--sky); transform-origin: bottom; transform: scaleY(.3); }
.eqs.on i { animation: bar .9s ease-in-out infinite; }
.eqs.on i:nth-child(2) { animation-delay: .15s; } .eqs.on i:nth-child(3) { animation-delay: .3s; } .eqs.on i:nth-child(4) { animation-delay: .45s; } .eqs.on i:nth-child(5) { animation-delay: .6s; }
.micbox > .eqs { display: none; }

.caption { position: absolute; left: 0; bottom: 84px; padding: 12px 18px; border-radius: 16px; background: var(--panel); border: 1.5px solid var(--line2); box-shadow: var(--shadow-sm);
  font-size: 19px; font-weight: 600; white-space: nowrap; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; animation: fadeUp .2s ease-out both; }
.caption small { display: block; font: 500 10px var(--f-mono); color: var(--sky); letter-spacing: .14em; margin-bottom: 4px; text-transform: uppercase; }
.caption.chat { width: max-content; max-width: min(430px, 70vw); min-width: 260px; white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.4; }
.caption.chat .you { font: 500 11px var(--f-mono); letter-spacing: .08em; color: var(--dim); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caption .dots i { animation: blink 1.2s infinite; font-style: normal; } .caption .dots i:nth-child(2) { animation-delay: .2s; } .caption .dots i:nth-child(3) { animation-delay: .4s; }
.menu { position: absolute; left: 0; bottom: 84px; width: 340px; padding: 16px; border-radius: 18px; background: var(--panel); border: 1.5px solid var(--line2); box-shadow: var(--shadow-sm); animation: fadeUp .2s ease-out both; }
.menu .k { font-size: 10.5px; color: var(--sky); }
.menu p { font-size: 15px; color: var(--dim); margin-top: 6px; }
.menu label { display: flex; justify-content: space-between; align-items: center; font-size: 15px; margin-top: 10px; }
.menu input[type=checkbox] { accent-color: #5fd0ff; width: 16px; height: 16px; }
.menu form { display: flex; gap: 6px; margin-top: 12px; }
.menu input[type=text] { flex: 1; min-width: 0; border-radius: 10px; background: var(--ink); border: 1.5px solid var(--line2); color: var(--white); font: 500 16px var(--f-text); padding: 8px 11px; outline: none; }
.menu input[type=text]:focus { border-color: var(--sky); }
.menu .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.menu .btn { font-size: 13px; padding: 7px 11px; }

/* toast */
.toast { position: fixed; top: 22px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 14px;
  background: var(--panel); border: 1.5px solid var(--white); box-shadow: var(--shadow-sm); font-size: 17px; font-weight: 600; animation: fadeDown .25s ease-out both; max-width: calc(100vw - 40px); }
.toast.err { border-color: var(--alert); box-shadow: 6px 6px 0 var(--alert); }
.toast .k { font-size: 10.5px; color: var(--sky); } .toast.err .k { color: var(--alert); }

@keyframes flow { to { transform: translateX(-50%); } }
@keyframes bar { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes cardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes fadeDown { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
