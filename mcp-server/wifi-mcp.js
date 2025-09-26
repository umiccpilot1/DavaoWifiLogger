#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create server
const server = new Server(
  {
    name: 'davao-wifi-logger',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Open database
const dbPath = path.join(__dirname, '..', 'database.sqlite');
console.error(`Opening database: ${dbPath}`);
let db;

try {
  db = new Database(dbPath, { readonly: false });
  console.error('Database opened successfully');
} catch (error) {
  console.error('Failed to open database:', error);
  process.exit(1);
}

// Handler for listing tools
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'getEmployeePresence',
        description: 'Get in/out times for an employee on a date',
        inputSchema: {
          type: 'object',
          properties: {
            employeeName: { type: 'string' },
            date: { type: 'string' }
          },
          required: ['employeeName', 'date']
        }
      },
      {
        name: 'getDailyReport',
        description: 'Get all employees for a date',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string' }
          },
          required: ['date']
        }
      },
      {
        name: 'getCurrentlyPresent',
        description: 'Get currently present employees',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handler for calling tools
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    console.error(`Calling tool: ${name}`);
    
    if (name === 'getEmployeePresence') {
      const stmt = db.prepare(`
        SELECT 
          device_name,
          datetime(logged_at, 'localtime') as connection_time,
          logged_at
        FROM wifi_logs
        WHERE device_name LIKE ?
          AND date(logged_at, 'localtime') = ?
        ORDER BY logged_at
      `);
      
      const logs = stmt.all(`%${args.employeeName}%`, args.date);
      
      // Process into sessions
      const sessions = [];
      let currentSession = null;
      
      for (let i = 0; i < logs.length; i++) {
        const current = logs[i];
        const prev = logs[i - 1];
        
        let isNewSession = !prev;
        if (prev) {
          const gap = (new Date(current.logged_at) - new Date(prev.logged_at)) / (1000 * 60);
          isNewSession = gap > 30;
        }
        
        if (isNewSession) {
          if (currentSession) sessions.push(currentSession);
          currentSession = {
            in_time: current.connection_time,
            out_time: current.connection_time
          };
        } else {
          currentSession.out_time = current.connection_time;
        }
      }
      
      if (currentSession) sessions.push(currentSession);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            employee: args.employeeName,
            date: args.date,
            sessions: sessions,
            total_logs: logs.length
          }, null, 2)
        }]
      };
    }
    
    if (name === 'getDailyReport') {
      const stmt = db.prepare(`
        SELECT 
          device_name,
          MIN(datetime(logged_at, 'localtime')) as first_seen,
          MAX(datetime(logged_at, 'localtime')) as last_seen,
          COUNT(*) as connection_count
        FROM wifi_logs
        WHERE date(logged_at, 'localtime') = ?
          AND device_name NOT LIKE '%Unknown%'
        GROUP BY device_name
        ORDER BY first_seen
      `);
      
      const employees = stmt.all(args.date);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            date: args.date,
            total_employees: employees.length,
            employees: employees
          }, null, 2)
        }]
      };
    }
    
    if (name === 'getCurrentlyPresent') {
      const stmt = db.prepare(`
        SELECT 
          device_name,
          MAX(datetime(logged_at, 'localtime')) as last_seen
        FROM wifi_logs
        WHERE logged_at > datetime('now', '-30 minutes')
          AND device_name NOT LIKE '%Unknown%'
        GROUP BY device_name
        ORDER BY last_seen DESC
      `);
      
      const present = stmt.all();
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            timestamp: new Date().toISOString(),
            count: present.length,
            employees: present
          }, null, 2)
        }]
      };
    }
    
    throw new Error(`Unknown tool: ${name}`);
    
  } catch (error) {
    console.error('Tool error:', error);
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }]
    };
  }
});

// Start server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running');
}

run().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});