// Tailwind was removed. Its `content` scanning silently dropped classes that
// were built at runtime, which needed a growing safelist to work around — a
// class of bug that is invisible in dev and only appears in the production
// build. styles.css is now plain CSS with design tokens: nothing to purge.
export default {
  plugins: {
    autoprefixer: {},
  },
};
