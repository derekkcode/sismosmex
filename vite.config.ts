import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { SeedLinkService } from './src/server/seedlink/service';
import { handleSeedLinkApiRequest } from './src/server/seedlink/api-router';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
    hmr: false,
    watch: {
      ignored: ['**/data/**', '**/*.json', '**/src/**', '**/node_modules/**', '**/.git/**'],
    },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  plugins: [
    {
      name: 'disable-vite-client-reloads',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html.replace(/<script type="module" src="\/@vite\/client"><\/script>/g, '');
        },
      },
      configureServer(server) {
        // Interceptar cualquier llamada residual a /@vite/client para que no ejecute bucles de reload
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/@vite/client')) {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(`
              export function createHotContext() {
                return {
                  accept() {},
                  prune() {},
                  dispose() {},
                  deactivate() {},
                  data: {},
                };
              }
              export function updateStyle() {}
              export function removeStyle() {}
              export default {};
            `);
            return;
          }
          next();
        });
      },
    },
    {
      name: 'seedlink-backend-plugin',
      configureServer(server) {
        // Inicializar el servicio de SeedLink
        const service = SeedLinkService.getInstance();

        // Conectar el servidor WebSocket al servidor HTTP de Vite
        if (server.httpServer) {
          const wss = new WebSocketServer({
            server: server.httpServer,
            path: '/ws',
          });
          service.attachWebSocketServer(wss);
          console.log('[VitePlugin] SeedLink WebSocket Server activo en ws://0.0.0.0:3000/ws');
        }

        // Middleware para APIs REST /api/seedlink/*
        server.middlewares.use((req, res, next) => {
          const handled = handleSeedLinkApiRequest(req, res);
          if (!handled) {
            next();
          }
        });
      },
    },
  ],
});
