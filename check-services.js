const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.all('SELECT id, user_id, name FROM services', (err, rows) => {
    if (err) {
        console.error('Error:', err);
    } else {
        console.log('Services in database:');
        console.log(JSON.stringify(rows, null, 2));
    }
    db.close();
});
