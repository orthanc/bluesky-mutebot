/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin');

module.exports = {
  content: ['./src/**/*.tsx'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bsky: '#0070ff',
      },
    },
  },
  plugins: [
    plugin(function ({ addVariant }) {
      addVariant('htmx-request', '.htmx-request &');
    }),
  ],
};
