const DB = require('better-sqlite3');
const db = new DB('C:/Users/ishan/OneDrive/Documents/Germannext/apps/educaro_local.db');
const userId = '079b8b7f-7c6d-4b06-9aa0-6fb6ad5c25b9';

console.log("--- BEFORE ---");
console.table(db.prepare('SELECT field_key, value FROM profile_fields WHERE user_id = ?').all(userId));

// Wipe fake AI extraction
db.prepare("DELETE FROM profile_fields WHERE user_id = ? AND provenance = 'AI_EXTRACTED'").run(userId);

// Wipe badly mapped user inputs
db.prepare("UPDATE profile_fields SET value = '' WHERE user_id = ? AND field_key IN ('fullName', 'location', 'degree')").run(userId);

// Fix applicant table name
db.prepare("UPDATE applicants SET name = '' WHERE user_id = ?").run(userId);

console.log("\n--- AFTER ---");
console.table(db.prepare('SELECT field_key, value, provenance FROM profile_fields WHERE user_id = ?').all(userId));
