const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const moment = require('moment'); // We'll use moment here too for consistency

const app = express();
const PORT = 3000;
const DB_FILE = 'database.sqlite';
const SOURCE_API_BASE_URL = 'http://10.208.103.250:5000/api/logs/';

// --- Database Setup ---
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS logs (Mac TEXT, Name TEXT, FirstSeen TEXT, LastSeen TEXT, UNIQUE(Mac, FirstSeen))`);
    }
});

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---
const normalizeName = (name) => {
    if (!name) return 'Unregistered Device';
    return name.replace(/\s*\(([^)]+)\)/, '').trim();
};

// Helper to format name as LASTNAME, FIRSTNAME for the report
const formatNameForExcel = (name) => {
    const parts = normalizeName(name).split(' ');
    if (parts.length < 2) return name;
    const lastName = parts.pop();
    const firstName = parts.join(' ');
    return `${lastName.toUpperCase()}, ${firstName.toUpperCase()}`;
};

// Heuristic to decide if a string is likely a human employee name
// Rules:
// - Not the placeholder 'Unregistered Device'
// - After normalization (removing device type in parentheses),
//   must contain at least 2 tokens that include letters
// - Avoid obvious garbage like empty strings
function isLikelyEmployeeName(rawName) {
    const normalized = normalizeName(rawName);
    if (!normalized || normalized === 'Unregistered Device') return false;
    const parts = normalized
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length < 2) return false;
    // at least two parts contain alphabetic characters
    const alphaParts = parts.filter(p => /[A-Za-z]/.test(p));
    return alphaParts.length >= 2;
}

// --- Reusable Data Fetching Function ---
async function getMonthlyPresenceData(year, month) {
    return new Promise((resolve, reject) => {
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        // Calculate the last day of the month correctly using moment
        const endDate = moment(`${year}-${month.toString().padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD');

    const sql = `SELECT Name, date(FirstSeen) as presenceDate FROM logs WHERE date(FirstSeen) BETWEEN ? AND ?`;
        db.all(sql, [startDate, endDate], (err, rows) => {
            if (err) return reject(err);

            const employeeData = new Map();
            rows.forEach(row => {
        const normalized = normalizeName(row.Name);
        // Include entries that look like actual employees (even without parentheses)
        if (isLikelyEmployeeName(row.Name)) {
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

            resolve(employees);
        });
    });
}

// --- API Endpoints ---

app.post('/api/sync', async (req, res) => {
    // ... Sync logic remains unchanged ...
    console.log('Starting data synchronization...');
    const daysToSync = 60; // Sync more days to be safe
    const sql = `INSERT OR IGNORE INTO logs (Mac, Name, FirstSeen, LastSeen) VALUES (?, ?, ?, ?)`;
    try {
        const stmt = db.prepare(sql);
        for (let i = 0; i < daysToSync; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toISOString().split('T')[0];
            const url = `${SOURCE_API_BASE_URL}?startDate=${dateString}&endDate=${dateString}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data)) {
                        data.forEach(log => stmt.run(log.Mac, log.Name, log.FirstSeen, log.LastSeen));
                    }
                    console.log(`Synced ${dateString}: Found ${data.length} records.`);
                }
            } catch (fetchError) {
                console.error(`Failed to fetch or process data for ${dateString}:`, fetchError.message);
            }
        }
        stmt.finalize();
        console.log('Synchronization process finished.');
        res.json({ message: `Sync complete. Checked the last ${daysToSync} days.` });
    } catch (error) {
        console.error('An error occurred during the sync process:', error);
        res.status(500).json({ error: 'An error occurred during synchronization.' });
    }
});


// Note: The original /api/presence-report endpoint is now simplified by using the shared function
// We will keep it in case you want to switch back to the calendar view later.
app.get('/api/presence-report', async (req, res) => {
    const { year, month } = req.query;
    try {
        const employees = await getMonthlyPresenceData(year, month);
        res.json({ employees, unregistered: [] }); // Simplified response
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route   GET /api/export-excel
 * @desc    Generates and returns an Excel attendance report.
 */
app.get('/api/export-excel', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required.' });
    }

    try {
        const employees = await getMonthlyPresenceData(year, month);
        const workbook = new ExcelJS.Workbook();
        const monthName = moment(`${year}-${month}-01`).format('MMMM YYYY');
        const worksheet = workbook.addWorksheet(monthName);

        // --- Define Structure ---
        const firstDayOfMonth = moment(`${year}-${month}-01`);
        const lastDayOfMonth = moment(`${year}-${month}-01`).endOf('month');
        const weeks = [];
        let currentDay = firstDayOfMonth.clone().startOf('month');

        // Group days into weeks (Mon-Fri)
        while (currentDay.isSameOrBefore(lastDayOfMonth, 'day')) {
            const weekStart = currentDay.clone().startOf('isoWeek'); // Start of week is Monday
            const weekEnd = weekStart.clone().add(4, 'days'); // End of week is Friday
            
            const week = {
                range: `${weekStart.format('MMM D')} - ${weekEnd.format('MMM D, YYYY')}`,
                days: []
            };
            for (let i = 0; i < 5; i++) {
                week.days.push(weekStart.clone().add(i, 'days'));
            }
            weeks.push(week);
            currentDay.add(1, 'week');
        }

        // --- Build Headers ---
        worksheet.columns = [{ header: 'Name', key: 'name', width: 30 }];
        const headerRow1 = worksheet.getRow(1);
        const headerRow2 = worksheet.getRow(2);
        headerRow2.getCell('A').value = 'Name';
        
        let currentColumn = 2;
        weeks.forEach(week => {
            // Merge cells for the week range header
            worksheet.mergeCells(1, currentColumn, 1, currentColumn + 4);
            headerRow1.getCell(currentColumn).value = week.range;
            headerRow1.getCell(currentColumn).style = { font: { bold: true }, alignment: { horizontal: 'center' } };

            // Add day letters
            week.days.forEach((day, index) => {
                const col = worksheet.getColumn(currentColumn + index);
                col.width = 5;
                col.style = { alignment: { horizontal: 'center', vertical: 'middle' }};
                headerRow2.getCell(currentColumn + index).value = day.format('dddd').substring(0,2) === 'Th' ? 'Th' : day.format('ddd').substring(0,1);
                headerRow2.getCell(currentColumn + index).style = { font: { bold: true }, alignment: { horizontal: 'center' } };
            });
            currentColumn += 6; // 5 days + 1 blank column
        });
        worksheet.getRow(2).getCell('A').style = { font: { bold: true } };

        // --- Add Data Rows ---
        employees.forEach((employee, index) => {
            const rowNumber = index + 3;
            const row = worksheet.getRow(rowNumber);
            row.getCell('A').value = employee.name;

            const presenceSet = new Set(employee.presenceDates);
            let dataColIndex = 2;
            weeks.forEach(week => {
                week.days.forEach(day => {
                    const cell = row.getCell(dataColIndex);
                    
                    // Only show data for days that belong to the target month
                    if (day.month() + 1 !== parseInt(month)) {
                        cell.value = ''; // Leave blank for days outside the month
                    } else if (presenceSet.has(day.format('YYYY-MM-DD'))) {
                        cell.value = '✓';
                        cell.font = { color: { argb: 'FF008000' } }; // Dark Green
                        cell.font.size  = 16;      
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFD3D3D3' } // Light Gray
                        };
                    } else {
                        cell.value = 'x';
                    }
                    dataColIndex++;
                });
                dataColIndex++; // Skip a column for the separator
            });
        });
                
        // --- Styling ---
        const borderStyle = { style: 'thin' };
        worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = {
                    top: borderStyle,
                    left: borderStyle,
                    bottom: borderStyle,
                    right: borderStyle
                };
            });
        });


        // --- Send File ---
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Presence-Report-${year}-${month}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Failed to generate Excel file:', error);
        res.status(500).send('Failed to generate Excel report.');
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});