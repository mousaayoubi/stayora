/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // A restrained navy/amber pair for the "premium concierge" framing
        // from the pitch deck - not a generic default-blue SaaS look.
        stayora: {
          navy: "#0f1b2d",
          gold: "#c9a15a",
        },
      },
    },
  },
  plugins: [],
};
