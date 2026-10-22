/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Hokkaido palette: milk paper, Furano lavender, Biei blue-pond, fresh grass, king-crab red.
        // Old scale names (snow, ice, slate) are kept so every component follows along.
        snow: { 50: '#fffcf5', 100: '#f7f1e4', 200: '#ece3cf' },
        // Blue Pond lake blue; 700/800 are the ink used for headings
        ice: {
          50: '#edf8fc',
          100: '#d9f0f8',
          200: '#b5e2f2',
          300: '#86cfea',
          400: '#52b8df',
          500: '#2e9fcb',
          600: '#1b7fad',
          700: '#2d2a4a',
          800: '#1f1c36',
        },
        lavender: {
          50: '#f6f2fd',
          100: '#ede6fa',
          200: '#dcd0f5',
          300: '#c7b5ee',
          400: '#b39be6',
          500: '#9b7fdb',
          600: '#7c5cc4',
          700: '#5e43a0',
        },
        crab: { 100: '#fde4de', 300: '#f7a796', 500: '#e8583e', 600: '#cc4129' },
        ink: { DEFAULT: '#2d2a4a', soft: '#5f5878' },
        mint: { 50: '#f0f9ea', 100: '#e1f3d5', 200: '#c8e9b0', 300: '#a6d985', 500: '#62b544', 800: '#2f5e22' },
        bluebell: { 100: '#dff2fa', 200: '#c2e6f5', 300: '#9ad5ee', 700: '#1f6f95' },
        butter: { 100: '#fff6da', 300: '#ffe38f', 500: '#f5c84c' },
        // soft lavender-grey neutrals instead of cool slate
        slate: {
          50: '#faf9fc',
          100: '#f1eff6',
          200: '#e2deec',
          300: '#cbc5da',
          400: '#9d96b3',
          500: '#7a7393',
          600: '#5f5878',
          700: '#48425e',
          800: '#36314a',
          900: '#27233a',
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
        sticker: '0 3px 0 0 #2d2a4a',
        'sticker-sm': '0 2px 0 0 #2d2a4a',
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
