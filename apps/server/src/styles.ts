/** Small, accessible visual system. No browser-side framework or theme dependencies. */
export const styles = `
:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.6;
  --canvas: #f4f7fb;
  --surface: #ffffff;
  --ink: #16283d;
  --muted: #4d6177;
  --nav: #102943;
  --border: #d5e0eb;
  --link: #144e83;
  --accent: #205b90;
  --focus: #974f00;
  --radius: 10px;
  background: var(--canvas);
  color: var(--ink);
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-height: 100vh; }
a { color: var(--link); text-underline-offset: 3px; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible, input:focus-visible,
textarea:focus-visible, select:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.skip-link { position: absolute; top: -80px; left: 12px; z-index: 10;
  padding: 10px 18px; background: #fff; color: var(--link); border-radius: 6px; }
.skip-link:focus { top: 12px; }
header { background: var(--nav); color: #fff; }
header a { color: #fff; }
.header-inner { max-width: 1100px; margin: auto; padding: 22px 24px; }
.brand { font-size: 1.35rem; font-weight: 750; text-decoration: none; }
.tagline { display: block; font-size: .88rem; color: #cfdeed; }
nav { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
nav form { margin: 0 0 0 auto; }
header nav a { padding: 5px 0; text-decoration: none; border-bottom: 3px solid transparent; }
header nav a[aria-current="page"] { font-weight: 750; border-bottom-color: #a5dcff; }
header nav a:hover { border-bottom-color: #fff; }
.quiet { border: 1px solid #a4bacf; background: transparent; color: #fff; padding: 5px 12px; }
main { max-width: 1100px; margin: auto; padding: 30px 24px; min-height: 65vh; }
.page-heading { display: flex; align-items: center; gap: 20px;
  justify-content: space-between; margin-bottom: 22px; }
h1 { font-size: clamp(1.5rem, 3vw, 1.9rem); line-height: 1.3; margin: 0; }
h2 { font-size: 1.15rem; margin: 0 0 16px; }
h3 { font-size: 1rem; }
p { margin: 0 0 15px; }
.panel, .post { background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 22px; margin: 0 0 20px; }
.narrow { max-width: 500px; }
.muted, time, .identity { color: var(--muted); font-size: .9rem; }
.thread { padding: 18px 0; border-bottom: 1px solid var(--border); }
.thread:last-child { border-bottom: 0; }
.thread a { font-weight: 650; font-size: 1.05rem; }
.meta { display: flex; gap: 10px; align-items: center;
  flex-wrap: wrap; font-size: .88rem; margin-bottom: 12px; }
.badge, .status { font-size: .78rem; line-height: 1.4; display: inline-block;
  padding: 3px 9px; border-radius: 999px; background: #e8eff7; color: #23456b; font-weight: 650; }
.badge.agent { background: #eee6fa; color: #533485; }
.status-pending { background: #fff2cf; color: #664400; }
.status-conflicted { background: #fde4e4; color: #842525; }
.status-approved { background: #dcf5e5; color: #17583b; }
.status-rejected { background: #e7ebef; color: #35465a; }
.post pre, .content { white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: inherit; line-height: 1.65; margin: 0; }
label { display: block; font-weight: 600; margin: 16px 0 6px; }
input, textarea, select { display: block; max-width: 100%; width: 100%;
  border: 1px solid #8298ad; border-radius: 6px; padding: 10px; font: inherit;
  background: #fff; color: var(--ink); }
textarea { min-height: 140px; resize: vertical; }
input[type="hidden"] { display: none; }
button, .button { display: inline-block; background: var(--accent); color: #fff;
  border: 0; border-radius: 6px; padding: 10px 17px; font: inherit;
  font-weight: 650; cursor: pointer; margin-top: 16px; text-decoration: none; }
button:hover { filter: brightness(.9); }
button.danger { background: #8b2830; }
.inline { display: inline-block; margin-right: 10px; }
.inline button { margin: 5px 0; }
.pager { justify-content: center; margin: 24px 0; }
.empty { color: var(--muted); padding: 20px 0; }
.notice { padding: 14px 18px; border-left: 4px solid #2461a8;
  border-radius: 4px; background: #edf4ff; margin: 16px 0; }
.warning { border-color: #966000; background: #fff6dd; }
footer { max-width: 1100px; margin: auto; padding: 20px 24px 36px;
  font-size: .82rem; color: var(--muted); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
code { overflow-wrap: anywhere; }
.diff { white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, monospace; font-size: .9rem; }
.diff-add { background: #e3f5e9; color: #175534; }
.diff-remove { background: #fee9e9; color: #702024; }
.token { word-break: break-all; user-select: all; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 700px) {
  .header-inner, main { padding-left: 16px; padding-right: 16px; }
  .page-heading { display: block; }
  nav { gap: 12px; }
  nav form { margin-left: 0; }
  .split { grid-template-columns: 1fr; }
  .panel, .post { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;
