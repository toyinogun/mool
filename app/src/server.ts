import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { createR2 } from './r2';
import { createRecordings } from './recording';
import { createUrls } from './urls';
import { createViewerPage } from './viewerPage';
import { createApp } from './app';

const config = loadConfig();
const r2 = createR2(config.r2);
const urls = createUrls({ publicAppUrl: config.publicAppUrl });
const recordings = createRecordings({
  dbPath: path.join(config.dataDir, 'db.sqlite'),
  mintUploadUrl: r2.mintUploadUrl,
  publicUrl: r2.publicUrl,
  viewerUrl: urls.viewerUrl,
});
const { renderViewerPage } = createViewerPage({
  template: readFileSync(
    path.join(__dirname, 'views', 'viewer.html'),
    'utf8',
  ),
});
const publicDir = path.join(__dirname, 'public');

const app = createApp({
  recordings,
  maxUploadBytes: config.maxUploadBytes,
  renderViewerPage,
  publicDir,
});

app.listen(config.port, () => {
  console.log(`Mool listening on :${config.port}`);
});
