const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

const db = new sqlite3.Database('database.sqlite');

// Helper functions (copied from server.js)
const normalizeName = (name) => {
    if (!name) return 'Unregistered Device';
    return name.replace(/\s*\(([^)]+)\)/, '').trim();
};

const formatNameForExcel = (name) => {
    const parts = normalizeName(name).split(' ');
    if (parts.length < 2) return name;
    const lastName = parts.pop();
    const firstName = parts.join(' ');
    return `${lastName.toUpperCase()}, ${firstName.toUpperCase()}`;
};

async function getMonthlyPresenceData(year, month) {
    return new Promise((resolve, reject) => {
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        // Calculate the last day of the month correctly using moment
        const endDate = moment(`${year}-${month.toString().padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD');

        console.log(`Querying from ${startDate} to ${endDate}`);
        
        const sql = `SELECT Name, date(FirstSeen) as presenceDate FROM logs WHERE date(FirstSeen) BETWEEN ? AND ?`;
        db.all(sql, [startDate, endDate], (err, rows) => {
            if (err) return reject(err);

            console.log(`Found ${rows.length} total records`);
            
            // Check specifically for July 31st data
            const july31Records = rows.filter(row => row.presenceDate === '2025-07-31');
            console.log(`July 31st records: ${july31Records.length}`);
            july31Records.forEach(record => {
                console.log(`  - ${record.Name} on ${record.presenceDate}`);
            });

            const employeeData = new Map();
            rows.forEach(row => {
                const normalized = normalizeName(row.Name);
                // Only include entries that look like actual employees
                if (normalized !== 'Unregistered Device' && row.Name.includes('(')) {
                    if (!employeeData.has(normalized)) {
                        employeeData.set(normalized, new Set());
                    }
                    employeeData.get(normalized).add(row.presenceDate);
                }
            });

            const employees = Array.from(employeeData.entries()).map(([name, dates]) => ({
                name: formatNameForExcel(name),
                presenceDates: Array.from(dates)
            })).sort((a, b) => a.name.localeCompare(b.name));

            // Check for specific employees
            const jhanVillasin = employees.find(emp => emp.name.includes('VILLASIN'));
            const joshuaVisande = employees.find(emp => emp.name.includes('VISANDE'));
            
            console.log('\nJHAN VILLASIN data:', jhanVillasin);
            console.log('JOSHUA VISANDE data:', joshuaVisande);

            resolve(employees);
        });
    });
}

// Test the function
getMonthlyPresenceData(2025, 7).then(result => {
    console.log(`\nTotal employees: ${result.length}`);
    db.close();
}).catch(err => {
    console.error('Error:', err);
    db.close();
});
