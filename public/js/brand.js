import { html, raw } from './ui.js';

export function logo(small) {
  return html`<div class="logo ${small ? 'logo-sm' : ''}">
    <svg viewBox="0 0 48 40" width="${small ? 34 : 44}" height="${small ? 28 : 36}" aria-hidden="true">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3c969"/><stop offset="1" stop-color="#c8902e"/></linearGradient></defs>
      <path d="M24 2 46 38H34L24 20 14 38H2z" fill="url(#lg)"/><path d="M24 20 31 32H17z" fill="#0f2340" opacity=".9"/>
    </svg>
    <div><b>ALPAGO</b><span>IT PORTAL</span></div></div>`;
}

export function skyline(cls = '') {
  // generic city skyline silhouette, deterministic
  let seed = 7;
  const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  let x = 0; let rects = '';
  while (x < 1000) {
    const w = 10 + Math.floor(r() * 18);
    const near = Math.abs(x - 500) < 140;
    const h = 25 + r() * (near ? 85 : 60);
    rects += `<rect x="${x}" y="${200 - h}" width="${w}" height="${h}"/>`;
    if (r() > 0.75) rects += `<rect x="${x + w / 2 - 1}" y="${200 - h - 10}" width="2" height="10"/>`;
    x += w + 2 + Math.floor(r() * 4);
  }
  return raw(`<svg class="sky ${cls}" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
    <g fill="currentColor">${rects}<path d="M494 200V96l2-6 1-26 1-30 1-34 1 34 1 30 1 26 2 6v104z"/><path d="M488 200v-60l6-6h12l6 6v60z"/></g></svg>`);
}
