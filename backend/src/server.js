// On hosts with a disk that resets on restart (e.g. Render free), set AUTO_SEED=1 to refill demo data.
if (process.env.AUTO_SEED) require('./seed');
const app = require('./app');
require('./messaging').startScheduler(); // automatic appointment reminders
const port = process.env.PORT || 5001;
app.listen(port, () => console.log(`Booking API running on http://localhost:${port}`));
