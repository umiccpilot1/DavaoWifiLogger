#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toLocalISOString(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clampIntervalToDay([start, end], dayStr) {
  const dayStart = new Date(`${dayStr}T00:00:00`);
  const dayEnd = new Date(`${dayStr}T23:59:59`);
  const s = new Date(Math.max(start.getTime(), dayStart.getTime()));
  const e = new Date(Math.min(end.getTime(), dayEnd.getTime()));
  if (e < s) return null;
  return [s, e];
}

function mergeSessions(intervals, gapMinutes = 30) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  let [curS, curE] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    const gap = (s.getTime() - curE.getTime()) / (1000 * 60);
    if (gap > gapMinutes) {
      merged.push([curS, curE]);
      curS = s; curE = e;
    } else {
      if (e > curE) curE = e;
    }
  }
  merged.push([curS, curE]);
  return merged;
}

class DavaoWifiMCPServer {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, '..', 'database.sqlite');
  }

  async initialize(customPath) {
    const dbPath = customPath || this.dbPath;
    console.error(`Connecting to database at: ${dbPath}`);
    try {
      this.db = await open({ filename: dbPath, driver: sqlite3.Database });
      this.dbPath = dbPath;
      console.error('Database connected successfully');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async ensureDb() {
    if (!this.db) await this.initialize();
  }

  normalizeName(name) {
    if (!name) return 'Unregistered Device';
    return name.replace(/\s*\(([^)]+)\)/, '').trim();
  }

  async getEmployeePresence({ employeeName, date, gapMinutes = 30 }) {
    await this.ensureDb();
    console.error(`getEmployeePresence employee=${employeeName} date=${date} gap=${gapMinutes}`);

    const rows = await this.db.all(
      `SELECT Name, FirstSeen, LastSeen FROM logs 
       WHERE date(FirstSeen) = ? OR date(LastSeen) = ?
       ORDER BY FirstSeen`,
      [date, date]
    );

    const target = employeeName.toLowerCase();
    const intervals = [];
    let canonicalName = null;
    for (const r of rows) {
      const norm = this.normalizeName(r.Name);
      if (!norm.toLowerCase().includes(target)) continue;
      canonicalName = canonicalName || norm;
      const start = new Date(r.FirstSeen);
      const end = new Date(r.LastSeen || r.FirstSeen);
      const clamped = clampIntervalToDay([start, end], date);
      if (clamped) intervals.push(clamped);
    }

    if (!intervals.length) {
      return { content: [{ type: 'text', text: `No logs found for ${employeeName} on ${date}` }] };
    }

    const merged = mergeSessions(intervals, gapMinutes);
    const sessions = merged.map(([s, e]) => ({ in_time: toLocalISOString(s), out_time: toLocalISOString(e) }));
    const totalMinutes = merged.reduce((acc, [s, e]) => acc + (e - s) / (1000 * 60), 0);

    const result = {
      employee: canonicalName,
      date,
      sessions,
      total_hours: Number(totalMinutes / 60).toFixed(2),
      first_in: sessions[0]?.in_time,
      last_out: sessions[sessions.length - 1]?.out_time
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  async getDailyReport({ date, gapMinutes = 30 }) {
    await this.ensureDb();
    console.error(`getDailyReport date=${date} gap=${gapMinutes}`);

    const rows = await this.db.all(
      `SELECT Name, FirstSeen, LastSeen FROM logs 
       WHERE date(FirstSeen) = ? OR date(LastSeen) = ?
       ORDER BY Name, FirstSeen`,
      [date, date]
    );

    const byName = new Map();
    for (const r of rows) {
      const norm = this.normalizeName(r.Name);
      if (norm.toLowerCase().includes('unknown') || norm.toLowerCase().includes('anonymous')) continue;
      const start = new Date(r.FirstSeen);
      const end = new Date(r.LastSeen || r.FirstSeen);
      const clamped = clampIntervalToDay([start, end], date);
      if (!clamped) continue;
      if (!byName.has(norm)) byName.set(norm, []);
      byName.get(norm).push(clamped);
    }

    const employees = [];
    for (const [name, ivals] of byName.entries()) {
      const merged = mergeSessions(ivals, gapMinutes);
      const sessions = merged.map(([s, e]) => ({ in_time: toLocalISOString(s), out_time: toLocalISOString(e) }));
      const totalMinutes = merged.reduce((acc, [s, e]) => acc + (e - s) / (1000 * 60), 0);
      employees.push({
        name,
        first_in: sessions[0]?.in_time || null,
        last_out: sessions[sessions.length - 1]?.out_time || null,
        sessions,
        total_hours: Number(totalMinutes / 60).toFixed(2)
      });
    }
    employees.sort((a, b) => (a.first_in || '').localeCompare(b.first_in || ''));

    const report = { date, total_employees: employees.length, employees };
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  }

  async getCurrentlyPresent({ windowMinutes = 30 } = {}) {
    await this.ensureDb();
    console.error(`getCurrentlyPresent window=${windowMinutes}m`);
    const rows = await this.db.all(
      `SELECT Name, MAX(LastSeen) as last_seen 
       FROM logs 
       WHERE datetime(LastSeen) > datetime('now', ?)
       GROUP BY Name`,
      [`-${windowMinutes} minutes`]
    );

    const employees = rows
      .map(r => ({ name: this.normalizeName(r.Name), last_seen: r.last_seen }))
      .filter(r => !/unknown|anonymous/i.test(r.name));

    const result = { timestamp: new Date().toISOString(), count: employees.length, employees };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  async exportReport({ date, gapMinutes = 30 }) {
    await this.ensureDb();
    const daily = await this.getDailyReport({ date, gapMinutes });
    const payload = JSON.parse(daily.content[0].text);
    const maxSessions = Math.max(0, ...payload.employees.map(e => e.sessions.length));
    const headers = ['Name'];
    for (let i = 1; i <= maxSessions; i++) headers.push(`In${i}`, `Out${i}`);
    headers.push('TotalHours');
    const lines = [headers.join(',')];
    for (const emp of payload.employees) {
      const row = [emp.name];
      for (let i = 0; i < maxSessions; i++) {
        row.push(emp.sessions[i]?.in_time || '', emp.sessions[i]?.out_time || '');
      }
      row.push(emp.total_hours);
      lines.push(row.map(v => (/,|"/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
    }
    const csv = lines.join('\n');
    return { content: [{ type: 'text', text: csv, mimeType: 'text/csv' }] };
  }

  async configureDatabase({ path: newPath } = {}) {
    if (newPath) {
      this.db = null;
      await this.initialize(newPath);
    } else {
      await this.ensureDb();
    }
    return { content: [{ type: 'text', text: JSON.stringify({ dbPath: this.dbPath }) }] };
  }

  async run() {
    const server = new Server(
      { name: 'davao-wifi-logger', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'configureDatabase',
          description: 'Configure or get the SQLite database path used by this server',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Absolute path to database.sqlite' } }
          }
        },
        {
          name: 'employeePresence',
          description: 'Get detailed in/out sessions for an employee on a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              employeeName: { type: 'string', description: 'Employee name (partial match ok)' },
              date: { type: 'string', description: 'Date in YYYY-MM-DD' },
              gapMinutes: { type: 'number', description: 'Gap minutes to split sessions (default 30)' }
            },
            required: ['employeeName', 'date']
          }
        },
        {
          name: 'presenceAnalytics',
          description: 'Analyze presence patterns for a date range',
          inputSchema: {
            type: 'object',
            properties: {
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              gapMinutes: { type: 'number' }
            },
            required: ['startDate', 'endDate']
          }
        },
        {
          name: 'currentStatus',
          description: "Who's currently in the office (LastSeen within N minutes)",
          inputSchema: { type: 'object', properties: { windowMinutes: { type: 'number' } } }
        },
        {
          name: 'exportReport',
          description: 'Generate CSV report with in/out columns for a given date',
          inputSchema: { type: 'object', properties: { date: { type: 'string' }, gapMinutes: { type: 'number' } }, required: ['date'] }
        }
      ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        switch (name) {
          case 'configureDatabase':
            return await this.configureDatabase(args || {});
          case 'employeePresence':
            return await this.getEmployeePresence(args);
          case 'presenceAnalytics': {
            const { startDate, endDate, gapMinutes = 30 } = args;
            const start = new Date(startDate);
            const end = new Date(endDate);
            const days = [];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const dayStr = d.toISOString().slice(0, 10);
              const rep = await this.getDailyReport({ date: dayStr, gapMinutes });
              const data = JSON.parse(rep.content[0].text);
              days.push({ date: dayStr, employees: data.employees });
            }
            const byName = new Map();
            for (const day of days) {
              for (const e of day.employees) {
                if (!byName.has(e.name)) byName.set(e.name, []);
                byName.get(e.name).push({ date: day.date, first_in: e.first_in, last_out: e.last_out, total_hours: e.total_hours });
              }
            }
            const summary = [];
            for (const [name, entries] of byName.entries()) {
              const totalHours = entries.reduce((acc, e) => acc + Number(e.total_hours || 0), 0);
              summary.push({ name, days_present: entries.length, total_hours: totalHours.toFixed(2), days: entries });
            }
            return { content: [{ type: 'text', text: JSON.stringify({ startDate, endDate, employees: summary }, null, 2) }] };
          }
          case 'currentStatus':
            return await this.getCurrentlyPresent(args || {});
          case 'exportReport':
            return await this.exportReport(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('Tool execution error:', error);
        return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('DavaoWifi MCP Server is running...');
  }
}

const mcpServer = new DavaoWifiMCPServer();
mcpServer.run().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
