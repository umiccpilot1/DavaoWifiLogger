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

            const dayStr = currentDay.format('YYYY-MM-DD');
            const isPresent = presentSet.has(day);
            if (isPresent) {
                classes += ' present';
            } else if (dayOfWeek > 0 && dayOfWeek < 6) { // It's a weekday (Mon-Fri)
                classes += ' absent';
            } else { // It's a weekend
                classes += ' weekend';
            }
            const hoverAttr = isPresent ? ` data-hover="1" data-date="${dayStr}"` : '';
            calendar += `<div class="${classes}"${hoverAttr} data-day="${day}">${day}</div>`;
        }

        calendar += '</div>';
        // After generating HTML, attach hover events using event delegation
        // Use a small timeout to ensure elements are in DOM
        setTimeout(() => attachHoverHandlers(), 0);
        return calendar;
    }

    function attachHoverHandlers() {
        const container = elements.reportContainer;
        container.off('mouseenter', '.calendar-day.present');
        container.off('mouseleave', '.calendar-day.present');
        container.on('mouseenter', '.calendar-day.present', async function() {
            const $el = $(this);
            const date = $el.data('date');
            const $card = $el.closest('.employee-card');
            const employeeName = $card.data('name');

            // Create tooltip element
            let $tip = $el.find('.hover-tip');
            if ($tip.length === 0) {
                $tip = $('<div class="hover-tip">Loading…</div>');
                $el.append($tip);
            }
            $tip.text('Loading…').addClass('visible');

            try {
                const resp = await fetch(`${API_URL}/api/day-sessions?name=${encodeURIComponent(employeeName)}&date=${encodeURIComponent(date)}`);
                if (!resp.ok) throw new Error('Failed');
                const data = await resp.json();
                if (!data.sessions || data.sessions.length === 0) {
                    $tip.html('<div class="tip-title">No sessions</div>');
                } else {
                    const items = data.sessions.map(s => `<div class="tip-row"><span>In</span><b>${s.in_time}</b></div><div class="tip-row"><span>Out</span><b>${s.out_time}</b></div>`).join('');
                    $tip.html(`<div class="tip-title">${employeeName}</div><div class="tip-sub">${date}</div>${items}<div class="tip-total">Total: ${data.total_hours}h</div>`);
                }
            } catch (e) {
                $tip.text('Error loading');
            }
        });
        container.on('mouseleave', '.calendar-day.present', function() {
            const $tip = $(this).find('.hover-tip');
            $tip.removeClass('visible');
            setTimeout(() => $tip.remove(), 150);
        });
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