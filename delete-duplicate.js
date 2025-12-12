const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

// Delete the duplicate Jellyfin service created by power user (id: 3)
db.run('DELETE FROM services WHERE id = 3', function(err) {
    if (err) {
        console.error('Error deleting service:', err);
    } else {
        console.log('Deleted service with id: 3');
        
        // Show remaining services
        db.all('SELECT id, user_id, name FROM services', (err, rows) => {
            if (err) {
                console.error('Error:', err);
            } else {
                console.log('Remaining services:');
                console.log(JSON.stringify(rows, null, 2));
            }
            db.close();
        });
    }
});
