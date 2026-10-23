import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // In development the page comes from Vite, so forward the socket connection to the NestJS server.
  server: { proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } } },
});
