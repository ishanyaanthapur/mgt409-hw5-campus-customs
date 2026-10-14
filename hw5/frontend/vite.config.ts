import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// strictPort: the backend's CORS allow-list is pinned to :5173, so fail loudly
// instead of silently moving to another port the backend would reject.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
