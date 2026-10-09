// Shared 3D scenes used by several slides (one WebGL context each).
// The scene's holder element is moved into whichever slide is active.

function withBreathBus(c) {
  if (c && !c.__bus) {
    c.__bus = true;
    c.__last = { t: 0, phase: 'insp', volume: 0 };
    c.onBreath?.((s) => { c.__last = s; });
  }
  return c;
}

export async function thorax(ctx, container) {
  const c = await ctx.shared('thorax', './three/lungs.js', { mode: 'thorax', autoRotate: true, interactive: true }, container);
  return withBreathBus(c);
}

export async function hero(ctx, container) {
  const c = await ctx.shared('hero', './three/lungs.js', { mode: 'hero', autoRotate: true, interactive: true }, container);
  return withBreathBus(c);
}
