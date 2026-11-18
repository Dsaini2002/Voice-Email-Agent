# Vaani "Wave" design

- `vaani-wave-design.html` — editable mockup of the design. Open it in Chrome and change the CSS.
- The real extension styles live in `extension/src/gmail/styles.ts`. Change the tokens in its `:host` block to re-theme everything:
  - colours: `--ink`, `--panel`, `--line`, `--blue`, `--sky`, `--white`, `--dim`
  - the signature hard shadow: `--shadow` (`10px 10px 0 var(--blue)`)
  - corner radius: `--r`, `--r-sm`
  - fonts: Sora (names/headings), Space Grotesk (text), JetBrains Mono (labels)
- `01-briefing.jpg` … `05-setup.jpg` — screenshots of the current design.

Rules of the design: blue / white / black only, bold cards with a hard blue shadow, the assistant's own name in big type, a living voice wave instead of a mic icon, no sci-fi HUD.
