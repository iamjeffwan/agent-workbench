import { app } from 'electron';

import { openElectronReviewDatabase } from '../electron/local-review-database.mjs';

app.whenReady().then(async () => {
  try {
    const database = await openElectronReviewDatabase({
      filePath: ':memory:',
      migrations: [{
        version: 1,
        name: 'review-storage-smoke',
        statements: ['CREATE TABLE review_storage_smoke (value TEXT NOT NULL) STRICT'],
      }],
    });
    database.prepare('INSERT INTO review_storage_smoke(value) VALUES (?)').run('ready');
    const row = database.prepare('SELECT value FROM review_storage_smoke').get();
    database.close();
    if (row?.value !== 'ready') throw new Error('SQLite smoke check returned an unexpected result.');
    process.stdout.write('Electron review SQLite smoke check passed.\n');
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    app.exit(1);
  }
});
