// Three looks for the app. Tailwind colour classes read these through CSS variables,
// so switching html[data-theme] repaints every component at once.
// a: cute Hokkaido stickers (default) · b: snow-country minimal · c: aurora night.

export const palettes = {
  a: {
    'snow-50': '#fffcf5', 'snow-100': '#f7f1e4', 'snow-200': '#ece3cf',
    'ice-50': '#edf8fc', 'ice-100': '#d9f0f8', 'ice-200': '#b5e2f2', 'ice-300': '#86cfea', 'ice-400': '#52b8df',
    'ice-500': '#2e9fcb', 'ice-600': '#1b7fad', 'ice-700': '#2d2a4a', 'ice-800': '#1f1c36',
    'lavender-50': '#f6f2fd', 'lavender-100': '#ede6fa', 'lavender-200': '#dcd0f5', 'lavender-300': '#c7b5ee',
    'lavender-400': '#b39be6', 'lavender-500': '#9b7fdb', 'lavender-600': '#7c5cc4', 'lavender-700': '#5e43a0',
    'crab-100': '#fde4de', 'crab-300': '#f7a796', 'crab-500': '#e8583e', 'crab-600': '#cc4129',
    ink: '#2d2a4a', 'ink-soft': '#5f5878',
    'mint-50': '#f0f9ea', 'mint-100': '#e1f3d5', 'mint-200': '#c8e9b0', 'mint-300': '#a6d985', 'mint-500': '#62b544', 'mint-800': '#2f5e22',
    'bluebell-100': '#dff2fa', 'bluebell-200': '#c2e6f5', 'bluebell-300': '#9ad5ee', 'bluebell-700': '#1f6f95',
    'butter-100': '#fff6da', 'butter-300': '#ffe38f', 'butter-500': '#f5c84c',
    'slate-50': '#faf9fc', 'slate-100': '#f1eff6', 'slate-200': '#e2deec', 'slate-300': '#cbc5da', 'slate-400': '#9d96b3',
    'slate-500': '#7a7393', 'slate-600': '#5f5878', 'slate-700': '#48425e', 'slate-800': '#36314a', 'slate-900': '#27233a',
  },
  // Snow white, sumi indigo, and one quiet accent: Otaru glass teal.
  b: {
    'snow-50': '#fcfcfa', 'snow-100': '#f4f4f1', 'snow-200': '#e7e7e2',
    'ice-50': '#f3f5f8', 'ice-100': '#e8ecf2', 'ice-200': '#d4dbe6', 'ice-300': '#b6c1d4', 'ice-400': '#8b9bb6',
    'ice-500': '#64779b', 'ice-600': '#3f5377', 'ice-700': '#1f2a44', 'ice-800': '#141c30',
    'lavender-50': '#f3f8f7', 'lavender-100': '#ebf3f2', 'lavender-200': '#d7e7e5', 'lavender-300': '#c5dcd9',
    'lavender-400': '#90bdb8', 'lavender-500': '#5f9a94', 'lavender-600': '#4e8c86', 'lavender-700': '#3b6c67',
    'crab-100': '#f6ebe8', 'crab-300': '#e3c3bb', 'crab-500': '#b5523e', 'crab-600': '#9e4433',
    ink: '#1f2a44', 'ink-soft': '#566079',
    'mint-50': '#f6f7f6', 'mint-100': '#eff1ef', 'mint-200': '#e3e7e3', 'mint-300': '#ccd5cd', 'mint-500': '#4e8c86', 'mint-800': '#3b4c3c',
    'bluebell-100': '#f2f4f8', 'bluebell-200': '#e5eaf1', 'bluebell-300': '#d0d9e5', 'bluebell-700': '#3f5377',
    'butter-100': '#f7f6f1', 'butter-300': '#e9e5d6', 'butter-500': '#c8bc96',
    'slate-50': '#fafafa', 'slate-100': '#f2f3f5', 'slate-200': '#e4e6ea', 'slate-300': '#cdd1d8', 'slate-400': '#9ca2ae',
    'slate-500': '#737a88', 'slate-600': '#565d6b', 'slate-700': '#3c4250', 'slate-800': '#2a2f3b', 'slate-900': '#1b1f28',
  },
  // Deep indigo night; fills are saturated so the light ink stays readable on them.
  c: {
    'snow-50': '#0b1030', 'snow-100': '#121a42', 'snow-200': '#1b2552',
    'ice-50': '#0f2440', 'ice-100': '#12304f', 'ice-200': '#164066', 'ice-300': '#1c6e8f', 'ice-400': '#22a4c9',
    'ice-500': '#3cc8ea', 'ice-600': '#5be0ff', 'ice-700': '#e9ecff', 'ice-800': '#ffffff',
    'lavender-50': '#1a1b4a', 'lavender-100': '#221f58', 'lavender-200': '#33287a', 'lavender-300': '#5a3fc4',
    'lavender-400': '#7b5cf0', 'lavender-500': '#9a7dff', 'lavender-600': '#b9a3ff', 'lavender-700': '#d6c9ff',
    'crab-100': '#3a1838', 'crab-300': '#a8306a', 'crab-500': '#ff4f8b', 'crab-600': '#ff7aa8',
    ink: '#e9ecff', 'ink-soft': '#a9b1e0',
    'mint-50': '#0e2a2a', 'mint-100': '#103a33', 'mint-200': '#145244', 'mint-300': '#1e8a63', 'mint-500': '#3dffa8', 'mint-800': '#b8ffe0',
    'bluebell-100': '#132c55', 'bluebell-200': '#1a3b6e', 'bluebell-300': '#24538f', 'bluebell-700': '#8fd8ff',
    'butter-100': '#33301f', 'butter-300': '#7a6420', 'butter-500': '#f5c84c',
    'slate-50': '#141b44', 'slate-100': '#1a2250', 'slate-200': '#2a3466', 'slate-300': '#3b467c', 'slate-400': '#6b76a8',
    'slate-500': '#8f99c8', 'slate-600': '#a9b1dd', 'slate-700': '#c3caee', 'slate-800': '#dce0fa', 'slate-900': '#eef0ff',
  },
};

// Shape language per theme: radii, outline width and the offset "sticker" shadow.
export const shapes = {
  a: {
    '--r-sm': '0.5rem', '--r-md': '0.75rem', '--r-lg': '1rem', '--r-xl': '1.5rem', '--r-pill': '9999px',
    '--bw': '2px',
    '--shadow-sticker': '0 3px 0 0 rgb(var(--c-ink))',
    '--shadow-sticker-sm': '0 2px 0 0 rgb(var(--c-ink))',
  },
  b: {
    '--r-sm': '2px', '--r-md': '2px', '--r-lg': '3px', '--r-xl': '4px', '--r-pill': '3px',
    '--bw': '1px',
    '--shadow-sticker': 'none',
    '--shadow-sticker-sm': 'none',
  },
  c: {
    '--r-sm': '0.75rem', '--r-md': '1rem', '--r-lg': '1.35rem', '--r-xl': '1.75rem', '--r-pill': '9999px',
    '--bw': '1px',
    '--shadow-sticker': '0 10px 30px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(150, 170, 255, 0.12)',
    '--shadow-sticker-sm': '0 6px 18px -10px rgba(0, 0, 0, 0.6)',
  },
};

export const themeColor = { a: '#fffcf5', b: '#fcfcfa', c: '#0b1030' };

function triplet(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** CSS custom properties for one theme: --c-<name> as "r g b" plus the shape tokens. */
export function themeVars(id) {
  const out = { ...shapes[id] };
  for (const [name, hex] of Object.entries(palettes[id])) out[`--c-${name}`] = triplet(hex);
  return out;
}

/** Tailwind colour map: { snow: { 50: 'rgb(var(--c-snow-50) / <alpha-value>)' }, ink: {...} } */
export function colorTokens() {
  const colors = {};
  for (const name of Object.keys(palettes.a)) {
    const value = `rgb(var(--c-${name}) / <alpha-value>)`;
    const dash = name.lastIndexOf('-');
    const scale = name.slice(0, dash);
    const step = name.slice(dash + 1);
    if (dash > 0 && /^\d+$/.test(step)) {
      colors[scale] = colors[scale] || {};
      colors[scale][step] = value;
    } else if (name === 'ink-soft') {
      colors.ink = colors.ink || {};
      colors.ink.soft = value;
    } else {
      colors[name] = colors[name] || {};
      colors[name].DEFAULT = value;
    }
  }
  return colors;
}
