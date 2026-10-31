'use strict';

const path = require('node:path');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const app = createApp({ dataDir: DATA_DIR });

app.listen(PORT, HOST, () => {
  console.log(`🏪 Dukkan is running on http://localhost:${PORT}`);
  console.log(`   Data directory: ${DATA_DIR}`);
});
