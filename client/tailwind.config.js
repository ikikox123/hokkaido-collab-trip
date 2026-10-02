/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        snow: { 50: '#f5f9fc', 100: '#e8f2f8', 200: '#d0e5f0' },
        ice: { 500: '#3b82c4', 600: '#2563a8', 700: '#1e4f8a' },
        sakura: { 400: '#f9a8d4', 500: '#ec4899' },
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
