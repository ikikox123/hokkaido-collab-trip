import plugin from 'tailwindcss/plugin';
import { colorTokens, themeVars } from './themes.js';

// Theme A is the base. B and C only apply on screen and never while a share image is captured,
// so print and exported images always use A.
const themeBase = plugin(({ addBase }) => {
  addBase({ ':root': themeVars('a') });
  addBase({
    '@media screen': {
      "html[data-theme='b']:not(.share-capturing)": themeVars('b'),
      "html[data-theme='c']:not(.share-capturing)": themeVars('c'),
    },
  });
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: colorTokens(),
      borderRadius: {
        lg: 'var(--r-sm)',
        xl: 'var(--r-md)',
        '2xl': 'var(--r-lg)',
        '3xl': 'var(--r-xl)',
        full: 'var(--r-pill)',
        // true circles (dots, number badges) stay round in every theme
        circle: '9999px',
      },
      borderWidth: {
        2: 'var(--bw)',
      },
      boxShadow: {
        sticker: 'var(--shadow-sticker)',
        'sticker-sm': 'var(--shadow-sticker-sm)',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
      spacing: {
        safe: 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
    },
  },
  plugins: [themeBase],
};
