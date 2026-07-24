/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./app.js",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#3525cd",
        "primary-container": "#4f46e5",
        "on-primary": "#ffffff",
        "on-primary-container": "#eef0ff",
        secondary: "#006c49",
        "secondary-container": "#dcfce9",
        "on-secondary-container": "#00532f",
        tertiary: "#7e3000",
        "tertiary-container": "#ffe3d3",
        error: "#ba1a1a",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",
        surface: "#faf8ff",
        "surface-container-low": "#f2f3ff",
        "surface-container": "#eaedff",
        "surface-container-high": "#e2e7ff",
        "surface-variant": "#dae2fd",
        outline: "#777587",
        "outline-variant": "#c7c4d8",
        "on-surface": "#131b2e",
        "on-surface-variant": "#464555",
        background: "#faf8ff"
      },
      fontFamily: { sans: ["Inter", "sans-serif"] },
      borderRadius: { DEFAULT: "0.5rem", lg: "0.75rem", xl: "1rem" }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ],
}
