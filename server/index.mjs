import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 59012);
const host = process.env.HOST || '0.0.0.0';

const app = await createApp({ projectRoot: process.cwd() });
await app.listen({ port, host });
console.log(`Argon Suncatcher Server listening on http://127.0.0.1:${port}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
