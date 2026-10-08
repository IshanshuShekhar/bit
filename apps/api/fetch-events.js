const Database = require('better-sqlite3');
const db = new Database('../educaro_local.db');
const rows = db.prepare(`SELECT agent, tool, reason, input, output, duration_ms, timestamp FROM agent_events WHERE tool = 'DocumentVisionParser' ORDER BY timestamp DESC LIMIT 5`).all();
console.log(JSON.stringify(rows, null, 2));
