'use strict';

const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`[web-login] http://localhost:${config.port}  (Kibana → ${config.kibana.url}, DB_TYPE=${config.db.type})`);
});
