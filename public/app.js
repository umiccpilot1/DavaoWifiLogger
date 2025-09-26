$(document).ready(function() {
    const API_URL = window.location.origin;
    let currentMoment = moment();

    const elements = {
        monthDisplay: $('#monthDisplay'),
        prevMonthBtn: $('#prevMonth'),
        nextMonthBtn: $('#nextMonth'),
        reportContainer: $('#reportContainer'),
        searchBox: $('#searchBox'),
        statusBar: $('#statusBar'),
        syncButton: $('#syncButton'),
        exportButton: $('#exportButton'), // <-- Add the new button element
        employeeTab: $('#employee-tab'),
        unregisteredTab: $('#unregistered-tab')
    };

    // --- INITIALIZATION ---
    loadReportFor(currentMoment);
    
    // --- EVENT LISTENERS ---
    
    // Add this new event listener for the export button
    elements.exportButton.on('click', function() {
        const year = currentMoment.year();
        const month = currentMoment.format('MM');
        const url = `${API_URL}/api/export-excel?year=${year}&month=${month}`;
        
        // Trigger the download by navigating to the URL
        window.location.href = url;
        elements.statusBar.text('Preparing Excel download...');
    });

    // ... The rest of your app.js file remains unchanged ...

    elements.prevMonthBtn.on('click', () => {
        currentMoment.subtract(1, 'month');
        loadReportFor(currentMoment);
    });

    elements.nextMonthBtn.on('click', () => {
        currentMoment.add(1, 'month');
        loadReportFor(currentMoment);
    });

    elements.searchBox.on('keyup', function() {
        const searchTerm = $(this).val().toLowerCase();
        $('.employee-card').each(function() {
            const employeeName = $(this).data('name').toLowerCase();
            if (employeeName.includes(searchTerm)) {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    });

    elements.syncButton.on('click', async function() {
        const $btn = $(this);
        const originalText = $btn.html();
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>Syncing...');
        elements.statusBar.text('Syncing with source API... This may take a minute.');

        try {
            const response = await fetch(`${API_URL}/api/sync`, { method: 'POST' });
            if (!response.ok) throw new Error('Sync failed');
            const result = await response.json();
            elements.statusBar.text(result.message);
            // Reload the current month's data after sync
            loadReportFor(currentMoment);
        } catch (error) {
            elements.statusBar.text('Error: Sync failed. Check the server console.');
            console.error('Sync Error:', error);
        } finally {
            $btn.prop('disabled', false).html(originalText);
        }
    });
    
    // --- The rest of the functions (loadReportFor, renderReport, etc.) remain the same ---
    async function loadReportFor(date) {
        elements.monthDisplay.text(date.format('MMMM YYYY'));
        elements.statusBar.text(`Loading data for ${date.format('MMMM YYYY')}...`);
        elements.reportContainer.html('<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>');
        
        const year = date.year();
        const month = date.format('MM');

        try {
            // Using the simplified /api/presence-report endpoint
            const response = await fetch(`${API_URL}/api/presence-report?year=${year}&month=${month}`);
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const data = await response.json();
            
            // Re-map name for display in the calendar view
            const displayData = { 
                employees: data.employees.map(e => ({...e, name: e.name.split(', ').reverse().join(' ')}))
            };

            renderReport(displayData, date);
            elements.statusBar.text(`Displaying ${data.employees.length} employees for ${date.format('MMMM YYYY')}.`);
        } catch (error) {
            elements.statusBar.text('Error loading data.');
            elements.reportContainer.html('<div class="alert alert-danger">Could not load report data. Is the backend server running?</div>');
            console.error('Load Report Error:', error);
        }
    }
    
    function renderReport(data, date) {
        elements.reportContainer.empty();
        elements.employeeTab.find('.badge').text(data.employees.length);
        
        if (data.employees.length === 0) {
            elements.reportContainer.html('<div class="alert alert-info">No employee presence data found for this month. You may need to Sync Data.</div>');
            return;
        }

        data.employees.forEach(employee => {
            const card = createEmployeeCard(employee, date);
            elements.reportContainer.append(card);
        });
    }

    function createEmployeeCard(employee, date) {
        const workingDays = getWorkingDaysInMonth(date);
        const presentCount = employee.presenceDates.length;

        const cardHtml = `
            <div class="col-md-6 col-lg-4">
                <div class="employee-card" data-name="${employee.name}">
                    <div class="employee-header">
                        <div class="employee-info">
                            <h5>${employee.name}</h5>
                        </div>
                        <span class="badge rounded-pill text-bg-danger days-badge">${presentCount}/${workingDays} Days</span>
                    </div>
                    ${generateCalendar(date, employee.presenceDates)}
                </div>
            </div>
        `;
        return cardHtml;
    }
    
    function generateCalendar(date, presentDates) {
        let calendar = '<div class="calendar-grid">';
        const headers = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        headers.forEach(h => calendar += `<div class="calendar-header">${h}</div>`);

        const month = date.month();
        const year = date.year();
        const firstDayOfMonth = moment({year, month}).day();
        const daysInMonth = date.daysInMonth();
        const presentSet = new Set(presentDates.map(d => moment(d).date()));

        for (let i = 0; i < firstDayOfMonth; i++) {
            calendar += '<div class="calendar-day empty"></div>';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const currentDay = moment({year, month, day});
            const dayOfWeek = currentDay.day();
            let classes = 'calendar-day';

            if (presentSet.has(day)) {
                classes += ' present';
            } else if (dayOfWeek > 0 && dayOfWeek < 6) { // It's a weekday (Mon-Fri)
                classes += ' absent';
            } else { // It's a weekend
                classes += ' weekend';
            }
            
            calendar += `<div class="${classes}">${day}</div>`;
        }

        calendar += '</div>';
        return calendar;
    }

    function getWorkingDaysInMonth(date) {
        const month = date.month();
        const year = date.year();
        let count = 0;
        for (let day = 1; day <= date.daysInMonth(); day++) {
            const dayOfWeek = moment({year, month, day}).day();
            if (dayOfWeek > 0 && dayOfWeek < 6) { // Mon-Fri
                count++;
            }
        }
        return count;
    }

});