'use strict';
/* Entry point: `npm start`. */
const config = require('./config');
const db = require('./db');
const { createApp } = require('./server');

const problems = config.assertProductionReady();
if (problems.length) {
  const fatal = config.env === 'production';
  console[fatal ? 'error' : 'warn'](
    `${fatal ? 'FATAL' : 'WARNING'} — configuration:\n  - ${problems.join('\n  - ')}`,
  );
  if (fatal) process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(
    `MTX sync server listening on :${config.port}  ` +
    `stores=[${config.stores.join(', ')}]  env=${config.env}`,
  );
});

function shutdown(signal) {
  console.log(`\n${signal} received — closing`);
  server.close(async () => {
    await db.closeAll();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
