/** @type {import('tailwindcss').Config} */
// Cute cream / salmon / mint palette. The old scale names (snow, ice, sakura, slate)
// are kept so every component picks up the new look without renaming classes.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // cream paper
        snow: { 50: '#fbf6ea', 100: '#f5ecd8', 200: '#ecdfc4' },
        // salmon accents; 700/800 are cocoa ink for headings
        ice: {
          50: '#fff4f0',
          100: '#fde7e1',
          200: '#f8d2c9',
          300: '#f2b4a8',
          400: '#eb9a8b',
          500: '#e2806f',
          600: '#cf5d4c',
          700: '#4a3226',
          800: '#36241b',
        },
        sakura: { 100: '#fbe3df', 400: '#f6b1a7', 500: '#e8857a' },
        ink: { DEFAULT: '#3b2a20', soft: '#6b5544' },
        mint: { 50: '#f1f8e9', 100: '#e3f1d4', 200: '#cde6b5', 300: '#b5d898', 500: '#7fb35c', 800: '#3d5f27' },
        bluebell: { 100: '#e1f0fa', 200: '#c7e3f5', 300: '#a5d2ee', 700: '#2f6d93' },
        butter: { 100: '#fff4cf', 300: '#fde38a', 500: '#f2c94c' },
        // warm browns instead of cool slate
        slate: {
          50: '#fbf7f0',
          100: '#f3ece0',
          200: '#e6dac7',
          300: '#d3c3ab',
          400: '#ab977e',
          500: '#87735e',
          600: '#6c5b4a',
          700: '#514336',
          800: '#3e3229',
          900: '#2f251e',
        },
      },
      fontFamily: {
        cute: [
          '"Zen Maru Gothic"',
          '"Huninn"',
          '"M PLUS Rounded 1c"',
          '"Kosugi Maru"',
          '"Arial Rounded MT Bold"',
          '"Noto Sans TC"',
          '"PingFang TC"',
          '"Hiragino Maru Gothic ProN"',
          '"Microsoft JhengHei"',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        sticker: '0 3px 0 0 #3b2a20',
        'sticker-sm': '0 2px 0 0 #3b2a20',
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
  plugins: [],
};
