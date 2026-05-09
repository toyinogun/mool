import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { openDb } from './db';
import { createR2 } from './r2';
import { createApp } from './app';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'db.sqlite'));
const r2 = createR2(config.r2);
const viewerTemplate = readFileSync(
  path.join(__dirname, 'views', 'viewer.html'),
  'utf8',
);
const publicDir = path.join(__dirname, 'public');

const app = createApp({
  db,
  r2,
  maxUploadBytes: config.maxUploadBytes,
  publicAppUrl: config.publicAppUrl,
  viewerTemplate,
  publicDir,
});

app.listen(config.port, () => {
  console.log(`Mool listening on :${config.port}`);
});
