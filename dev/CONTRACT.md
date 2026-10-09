# Pulmonary Mechanics deck — shared build contract

Project root: `D:\Claude\Dhiyaa-revision\pulmonary-mechanics` (static site, no build step, deployed to GitHub Pages).
Local server already running: **http://127.0.0.1:5173/** (serves the project root).

## Look & feel (Apple keynote style)
- Projected on a LARGE screen. Everything must read from the back of a hall: thick lines, big labels, high contrast, no hairlines, no tiny text.
- Clean, calm, premium: smooth easing (no bounce, no jitter), soft studio lighting, subtle glow, generous negative space.
- Default theme is **dark** (pure black `#000` page). A **light** theme exists (`#fbfbfd` page) — every module must implement `setTheme('dark'|'light')`.
- Renderers use `alpha: true` and a transparent clear colour so the page background shows through. `antialias: true`, `setPixelRatio(Math.min(devicePixelRatio, 2))`, `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`.

### Colour tokens (use these exact values, dark / light)
| token   | dark      | light     | meaning |
|---------|-----------|-----------|---------|
| text    | `#f5f5f7` | `#1d1d1f` | |
| text2   | `#a1a1a6` | `#6e6e73` | |
| blue    | `#2997ff` | `#0071e3` | air, inspiration, lung curve |
| cyan    | `#64d2ff` | `#0a84c6` | volume |
| green   | `#30d158` | `#1f9d48` | pleural pressure, normal, dilation |
| pink    | `#ff375f` | `#e0254e` | alveolar pressure |
| orange  | `#ff9f0a` | `#d97a00` | expiration, obstructive |
| purple  | `#bf5af2` | `#9b3fd1` | chest wall, restrictive |
| yellow  | `#ffd60a` | `#c9a400` | highlight / focus |
| red     | `#ff453a` | `#d70015` | danger, constriction, collapse |
| tissue  | `#ff8fa3` | `#e8657d` | lung tissue / alveolar wall |

Font for any text drawn in WebGL/canvas: `"SF Pro Display", "Inter", system-ui, sans-serif`, weight 600, large.

## 3D module interface (ES modules)
Each module lives in `js/three/<name>.js` and imports Three via the import map:
```html
<script type="importmap">
{ "imports": { "three": "../vendor/three/three.module.js", "three/addons/": "../vendor/three/addons/" } }
</script>
```
(From the deck root the paths are `./vendor/...`; from `dev/` they are `../vendor/...`. Modules themselves only import the bare specifiers `three` and `three/addons/...`, so they work from both.)

Three.js version is **r160** (`vendor/three/three.module.js`). Addons available under `vendor/three/addons/`: controls, postprocessing, shaders, geometries, utils, environments, math, lines, objects, curves, modifiers, misc.

Every module exports `mount(container, options = {})` that:
- creates its own renderer + canvas, sized to fill `container` (position the canvas absolutely at 100% × 100%), tracks size with a `ResizeObserver`;
- does **not** render until `start()` is called (the deck calls `start()` when the slide becomes active and `stop()` when it leaves — at most one or two scenes animate at once);
- returns a controller with at least `start()`, `stop()`, `dispose()`, `setTheme(theme)`, plus the module-specific API.
- uses its own `requestAnimationFrame` loop that is cancelled in `stop()`; time-based animation (use `THREE.Clock` delta, clamp delta to ≤ 0.05 s) so it looks the same at 60/120 Hz.
- must not attach global listeners other than on its own canvas (pointer events for OrbitControls are fine; disable zoom on wheel so the deck can scroll/navigate — set `controls.enableZoom = false`, `enablePan = false`).
- no external network requests (no CDN textures/HDRIs). Build environment lighting with `RoomEnvironment` + `PMREMGenerator` or plain lights. Textures must be generated procedurally (CanvasTexture / DataTexture).
- HTML labels are drawn by the deck, not by the module. Modules expose `getAnchors()` returning `{ name: {x, y, visible} }` in CSS pixels relative to the container's top-left, so the deck can pin HTML labels to 3D points.

Each module also ships a demo page `dev/<name>.html` (dark page, full-window container, a small control bar exercising the whole API, theme toggle). Test it at `http://127.0.0.1:5173/dev/<name>.html`.
