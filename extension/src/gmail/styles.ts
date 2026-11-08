/** JARVIS HUD styles, scoped inside the Shadow DOM so Gmail's CSS never leaks in (or out). */
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:host {
  --cy: #46d9ff; --cy2: #9becff; --blue: #2a7bff; --ink: #030914; --white: #f2fbff;
  --glass: rgba(6, 18, 38, 0.66); --line: rgba(110, 210, 255, 0.38); --dim: rgba(200, 235, 255, 0.66); --alert: #ff7a7a;
  --f-hud: VaaniOrbitron, "Segoe UI", sans-serif; --f-text: VaaniRajdhani, "Segoe UI", sans-serif; --f-mono: VaaniMono, ui-monospace, monospace;
  font-family: var(--f-text); color: var(--white);
}
.overlay, .micwrap, .toast, #toast { color: var(--white); font-family: var(--f-text); font-size: 16px; line-height: 1.3; -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; text-align: inherit; }
.mono { font-family: var(--f-mono); letter-spacing: .1em; text-transform: uppercase; }

/* ---------- overlay (transparent layer on top of Gmail) ---------- */
.overlay { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .25s ease; }
.overlay.open { opacity: 1; }
.overlay .bg { position: absolute; inset: 0;
  background: radial-gradient(1200px 700px at 70% 45%, rgba(20,70,140,.35), transparent 70%), linear-gradient(rgba(2,8,20,.6), rgba(2,8,20,.7));
  backdrop-filter: blur(2.5px) saturate(1.1); }
.overlay.full .bg { background: radial-gradient(1200px 700px at 50% 40%, rgba(25,80,160,.38), transparent 70%), linear-gradient(rgba(2,8,20,.76), rgba(2,8,20,.82)); backdrop-filter: blur(4px); }
.overlay .bg::before { content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(rgba(70,200,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(70,200,255,.06) 1px, transparent 1px);
  background-size: 48px 48px; mask-image: radial-gradient(ellipse at 60% 50%, #000 30%, transparent 85%); }
.overlay .bg::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px); }
.edge { position: absolute; width: 56px; height: 56px; border: 2px solid var(--cy); opacity: .7; }
.edge.tl { top: 14px; left: 14px; border-right: 0; border-bottom: 0; } .edge.tr { top: 14px; right: 14px; border-left: 0; border-bottom: 0; }
.edge.bl { bottom: 14px; left: 14px; border-right: 0; border-top: 0; } .edge.br { bottom: 14px; right: 14px; border-left: 0; border-top: 0; }
.pa { pointer-events: auto; }

/* command bar */
.cmd { position: absolute; top: 24px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 180px);
  padding: 10px 22px; border: 1px solid var(--line); background: var(--glass); clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  box-shadow: 0 0 30px rgba(70,200,255,.15) inset; white-space: nowrap; }
.cmd .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--cy); box-shadow: 0 0 10px var(--cy); flex: none; }
.cmd .lbl { font-size: 11px; color: var(--cy); }
.cmd .q { font-size: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.cmd .count { font-size: 12px; color: var(--cy2); padding-left: 14px; border-left: 1px solid var(--line); }
.closeX { position: absolute; top: 22px; right: 28px; width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--line); background: var(--glass); color: var(--dim); font-size: 18px; }
.closeX:hover { color: var(--white); border-color: var(--cy); }

/* card stack (left) */
.stack { position: absolute; left: 32px; top: 92px; width: min(440px, 36vw); bottom: 140px; overflow-y: auto; overflow-x: hidden; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.stack-h { display: flex; justify-content: space-between; font-size: 11px; color: var(--cy); margin: 0 0 12px 34px; }
.stack-h b { font-weight: 500; color: var(--cy2); }
.timeline { position: absolute; left: 12px; top: 28px; bottom: 0; width: 2px; background: linear-gradient(var(--cy), rgba(70,200,255,.05)); }
.hc { position: relative; margin: 0 0 12px 34px; padding: 13px 16px; background: var(--glass); border: 1px solid var(--line); cursor: pointer; text-align: left; width: calc(100% - 34px); display: block;
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%); animation: cardIn .45s ease-out both; }
.hc:hover { border-color: var(--cy); }
.hc::before { content: ""; position: absolute; left: -29px; top: 20px; width: 10px; height: 10px; border: 2px solid var(--cy); background: var(--ink); transform: rotate(45deg); }
.col .hc { margin-left: 0; width: 100%; } .col .hc::before { display: none; }
.hc .top { display: flex; align-items: center; gap: 10px; }
.hc .idx { font-size: 11px; color: var(--cy); }
.hc .time { margin-left: auto; font-size: 11px; color: var(--dim); }
.hc .co { font-weight: 700; font-size: 22px; margin-top: 6px; line-height: 1.1; }
.hc .sum { font-size: 16.5px; font-weight: 500; color: rgba(225,243,255,.88); margin-top: 3px; line-height: 1.3; }
.hc .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.chip { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; padding: 2px 7px; background: rgba(70,200,255,.1); border-left: 2px solid var(--cy); color: var(--cy2); }
.chip.hot { border-color: var(--white); color: var(--white); background: rgba(255,255,255,.12); }
.hc.done { opacity: .6; } .hc.done .sum { display: none; }
.hc.now { border-color: var(--cy); background: linear-gradient(100deg, rgba(20,80,150,.62), rgba(6,18,38,.72)); box-shadow: 0 0 0 1px rgba(70,220,255,.5), 0 0 34px rgba(70,200,255,.35); }
.hc.now::before { background: var(--cy); box-shadow: 0 0 14px var(--cy); }
.speaking { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--cy); }
.hc.incoming { animation: none; opacity: .3; transform: translateX(-26px); filter: blur(1.5px); }

.tag { font-family: var(--f-mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 3px 8px; border: 1px solid currentColor; white-space: nowrap; }
.t-white { color: #ffffff; background: rgba(255,255,255,.12); } .t-blue { color: #8fb8ff; background: rgba(60,120,255,.18); }
.t-cy { color: #7ff0ff; background: rgba(70,220,255,.12); } .t-cy2 { color: #b7d7ff; background: rgba(140,180,255,.12); }
.t-dim { color: #8aa3b8; background: rgba(120,150,170,.12); } .t-alert { color: var(--alert); background: rgba(255,80,80,.14); }

/* agent core + subtitle */
.core { position: absolute; left: 58%; top: 44%; width: min(400px, 30vw); aspect-ratio: 1; transform: translate(-50%, -50%); }
.core svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.core .spin { animation: spin 24s linear infinite; } .core .spinr { animation: spinr 36s linear infinite; }
.core.busy .spin { animation-duration: 4s; } .core.busy .spinr { animation-duration: 6s; }
.core .name { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
.core .name b { font-family: var(--f-hud); font-size: clamp(18px, 2.1vw, 30px); letter-spacing: .3em; text-shadow: 0 0 18px var(--cy); display: block; }
.core .name small { font-family: var(--f-mono); font-size: 11px; color: var(--cy); letter-spacing: .25em; display: block; margin-top: 6px; }
.subtitle { position: absolute; left: calc(min(440px, 36vw) + 70px); right: 60px; top: calc(44% + min(220px, 16.5vw)); text-align: center; }
.subtitle .who { font-size: 11px; color: var(--cy); margin-bottom: 10px; }
.subtitle p { font-size: clamp(19px, 1.9vw, 27px); font-weight: 600; line-height: 1.35; text-shadow: 0 0 12px rgba(0,0,0,.6); }
.subtitle mark { background: none; color: var(--cy); text-shadow: 0 0 12px rgba(70,220,255,.7); }

.readouts { position: absolute; right: 40px; top: 96px; width: 180px; display: grid; gap: 10px; }
.ro { border-left: 2px solid var(--cy); padding: 6px 12px; background: linear-gradient(90deg, rgba(70,200,255,.12), transparent); }
.ro .k { font-size: 10px; color: var(--cy); } .ro .v { font-family: var(--f-hud); font-size: 26px; font-weight: 700; }

.hints { position: absolute; left: 340px; right: 40px; bottom: 30px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; align-items: center; }
.hints .k { font-size: 11px; color: var(--cy); }
.hint { font-weight: 600; font-size: 16px; padding: 7px 14px; border: 1px solid var(--line); background: rgba(6,18,38,.6); }
.hint b { color: var(--cy); } .hint:hover { border-color: var(--cy); }

/* focus card */
.focus { position: absolute; left: 32px; top: 92px; width: min(600px, 46vw); padding: 26px 28px; background: linear-gradient(140deg, rgba(14,60,120,.64), rgba(4,14,32,.8));
  border: 1px solid var(--cy); box-shadow: 0 0 0 1px rgba(70,220,255,.35), 0 0 60px rgba(70,200,255,.28);
  clip-path: polygon(0 0, calc(100% - 28px) 0, 100% 28px, 100% 100%, 28px 100%, 0 calc(100% - 28px)); animation: cardIn .4s ease-out both; }
.focus .big { font-family: var(--f-hud); font-weight: 700; font-size: clamp(26px, 2.8vw, 40px); letter-spacing: .1em; margin-top: 14px; text-shadow: 0 0 20px rgba(70,220,255,.5); overflow-wrap: anywhere; }
.focus .subj { font-size: 19px; color: var(--dim); margin-top: 2px; }
.focus .sumbig { font-size: 21px; font-weight: 600; margin-top: 14px; line-height: 1.35; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
.cell { padding: 10px 14px; border: 1px solid var(--line); background: rgba(70,200,255,.06); }
.cell.hot { border-color: rgba(255,255,255,.7); background: rgba(255,255,255,.08); }
.cell .k { font-size: 10px; color: var(--cy); } .cell .v { font-size: 21px; font-weight: 700; margin-top: 2px; }
.conf { margin-top: 16px; display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--cy2); }
.bar { flex: 1; height: 6px; background: rgba(255,255,255,.1); position: relative; }
.bar i { position: absolute; top: 0; bottom: 0; left: 0; background: linear-gradient(90deg, var(--blue), var(--cy)); box-shadow: 0 0 10px var(--cy); }
.acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.btn { font-weight: 700; font-size: 16px; padding: 9px 16px; border: 1px solid var(--cy); background: rgba(70,200,255,.14); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
.btn:hover { background: rgba(70,200,255,.26); box-shadow: 0 0 18px rgba(70,217,255,.35); }
.btn.solid { background: linear-gradient(90deg, var(--blue), var(--cy)); color: var(--ink); border-color: transparent; }
.btn.ghost { background: transparent; border-color: var(--line); }
.btn.alert { color: var(--alert); border-color: rgba(255,122,122,.6); background: rgba(255,80,80,.08); }

/* full window */
.fullhead { position: absolute; top: 88px; left: 56px; right: 56px; display: flex; gap: 14px; }
.stat { flex: 1; padding: 12px 18px; border: 1px solid var(--line); background: var(--glass); clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%); }
.stat .k { font-size: 10px; color: var(--cy); } .stat .v { font-family: var(--f-hud); font-weight: 700; font-size: 30px; margin-top: 4px; }
.cols { position: absolute; top: 190px; left: 56px; right: 56px; bottom: 100px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; overflow-y: auto; }
.col h3 { font-family: var(--f-mono); font-weight: 500; font-size: 11px; letter-spacing: .16em; color: var(--cy); padding-bottom: 8px; border-bottom: 1px solid var(--line); margin-bottom: 12px; display: flex; justify-content: space-between; text-transform: uppercase; }
.col h3.alert { color: var(--alert); border-color: rgba(255,122,122,.5); }

/* confirm (delete spam) */
.confirm { position: absolute; left: 32px; top: 92px; width: min(560px, 44vw); padding: 24px 26px; border: 1px solid rgba(255,255,255,.75); background: linear-gradient(140deg, rgba(14,40,80,.7), rgba(4,12,28,.85));
  box-shadow: 0 0 50px rgba(70,200,255,.25); clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%); animation: cardIn .35s ease-out both; }
.confirm .big { font-family: var(--f-hud); font-size: 30px; font-weight: 700; margin-top: 10px; }
.confirm ul { list-style: none; margin-top: 14px; display: grid; gap: 6px; }
.confirm li { font-size: 16px; padding: 6px 10px; border-left: 2px solid var(--line); background: rgba(255,255,255,.04); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.confirm li b { color: var(--cy2); }
.confirm .say { margin-top: 14px; font-size: 18px; } .confirm .say b { color: var(--cy); }

/* setup panel */
.confirm.setup { width: min(620px, 48vw); border-color: var(--cy); }
.step { display: flex; gap: 14px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.step .num { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--cy); color: var(--cy); font-family: var(--f-hud); font-size: 13px; }
.step.done .num { background: var(--cy); color: var(--ink); }
.step .st { font-size: 20px; font-weight: 700; }
.step p { font-size: 16px; color: var(--dim); margin-top: 4px; line-height: 1.4; }
.step p b { color: var(--white); }
.step a, .lnk { color: var(--cy); font-weight: 700; text-decoration: none; } .lnk { margin-left: 8px; }
.step .acts { margin-top: 10px; }
.keyform { display: flex; gap: 8px; margin-top: 10px; }
.keyform input { flex: 1; min-width: 0; background: rgba(2,8,20,.85); border: 1px solid var(--line); color: var(--white); font: 600 14px var(--f-mono); padding: 9px 12px; outline: none; }
.keyform input:focus { border-color: var(--cy); box-shadow: 0 0 12px rgba(70,217,255,.3); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.confirm p.warn { color: #ffb3b3; margin-top: 12px; font-size: 16px; } .confirm p.ok { color: var(--cy2); margin-top: 12px; font-size: 16px; }
.step p.warn { color: #ffb3b3; }
.hint2 { margin-top: 10px; font-size: 16px; color: var(--dim); } .hint2 b { color: var(--cy); }

/* ---------- always-visible mic box (bottom-left) ---------- */
.micwrap { position: fixed; left: 22px; bottom: 22px; pointer-events: auto; }
.micbox { display: flex; align-items: center; gap: 12px; padding: 8px 16px 8px 8px; background: rgba(4,12,28,.9); border: 1px solid var(--line); border-radius: 40px;
  box-shadow: 0 0 0 1px rgba(70,220,255,.15), 0 10px 30px rgba(0,30,80,.35), 0 0 30px rgba(70,200,255,.25); backdrop-filter: blur(10px); }
.micbox.bad { border-color: rgba(255,122,122,.6); }
.micbox .r { width: 46px; height: 46px; position: relative; flex: none; }
.micbox .r svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.micbox .r .spin { animation: spin 10s linear infinite; }
.micbox .r .ic { position: absolute; inset: 0; display: grid; place-items: center; }
.micbox .t b { font-family: var(--f-hud); font-size: 12px; letter-spacing: .25em; display: block; }
.micbox .t small { font-family: var(--f-mono); font-size: 9.5px; letter-spacing: .12em; color: var(--cy); display: flex; align-items: center; gap: 6px; margin-top: 4px; text-transform: uppercase; }
.micbox .t small i { width: 7px; height: 7px; border-radius: 50%; background: #8aa3b8; }
.micbox .t small i.live { background: #3dffa8; box-shadow: 0 0 8px #3dffa8; animation: blink 1.8s ease-in-out infinite; }
.micbox .t small i.bad { background: var(--alert); }
.eqs { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; }
.eqs i { width: 3px; height: 100%; background: var(--cy); box-shadow: 0 0 6px var(--cy); transform-origin: bottom; transform: scaleY(.3); }
.eqs.on i { animation: bar .9s ease-in-out infinite; }
.eqs.on i:nth-child(2) { animation-delay: .15s; } .eqs.on i:nth-child(3) { animation-delay: .3s; } .eqs.on i:nth-child(4) { animation-delay: .45s; } .eqs.on i:nth-child(5) { animation-delay: .6s; }
.caption { position: absolute; left: 0; bottom: 74px; padding: 10px 16px; background: rgba(4,12,28,.92); border: 1px solid var(--line); font-size: 19px; font-weight: 600;
  box-shadow: 0 0 24px rgba(70,200,255,.25); white-space: nowrap; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; animation: fadeUp .2s ease-out both;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%); }
.caption small { display: block; font-family: var(--f-mono); font-size: 10px; color: var(--cy); letter-spacing: .14em; margin-bottom: 3px; font-weight: 500; }
.menu { position: absolute; left: 0; bottom: 74px; width: 330px; padding: 14px; background: rgba(4,12,28,.95); border: 1px solid var(--line); box-shadow: 0 0 30px rgba(70,200,255,.25);
  clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%); animation: fadeUp .2s ease-out both; }
.menu .k { font-size: 10.5px; color: var(--cy); }
.menu p { font-size: 15px; color: var(--dim); margin-top: 4px; }
.menu label { display: flex; justify-content: space-between; align-items: center; font-size: 15px; margin-top: 10px; }
.menu input[type=checkbox] { accent-color: #46d9ff; width: 16px; height: 16px; }
.menu form { display: flex; gap: 6px; margin-top: 12px; }
.menu input[type=text] { flex: 1; min-width: 0; background: rgba(2,8,20,.8); border: 1px solid var(--line); color: var(--white); font: 600 16px var(--f-text); padding: 7px 10px; outline: none; }
.menu input[type=text]:focus { border-color: var(--cy); box-shadow: 0 0 12px rgba(70,217,255,.3); }
.menu .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.menu .btn { font-size: 13px; padding: 6px 10px; }

/* toast */
.toast { position: fixed; top: 22px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 14px; padding: 12px 18px;
  background: rgba(4,12,28,.94); border: 1px solid var(--cy); box-shadow: 0 0 30px rgba(70,200,255,.35); font-size: 18px; font-weight: 600; animation: fadeDown .25s ease-out both; max-width: calc(100vw - 40px); }
.toast.err { border-color: var(--alert); }
.toast .k { font-size: 10.5px; color: var(--cy); } .toast.err .k { color: var(--alert); }

@keyframes spin { to { transform: rotate(360deg); } } @keyframes spinr { to { transform: rotate(-360deg); } }
@keyframes bar { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes cardIn { from { opacity: 0; transform: translateX(-24px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes fadeDown { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
