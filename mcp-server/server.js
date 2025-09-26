#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection
let db = null;

async function initDatabase() {
  const dbPath = path.join(__dirname, '..', 'database.sqlite');
  console.error(`Connecting to database at: ${dbPath}`);
  
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    console.error('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

// Tool implementations
async function getEmployeePresence(args) {
  const { employeeName, date } = args;
  console.error(`Getting presence for ${employeeName} on ${date}`);
  
  if (!db) await initDatabase();
  
  const query = `
    SELECT 
      device_name,
      datetime(logged_at, 'localtime') as connection_time,
      logged_at
    FROM wifi_logs
    WHERE device_name LIKE ?
      AND date(logged_at, 'localtime') = ?
    ORDER BY logged_at
  `;

  const logs = await db.all(query, [`%${employeeName}%`, date]);
  
  if (logs.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No logs found for ${employeeName} on ${date}`
      }]
    };
  }

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
        employee: logs[0].device_name,
        date: date,
        sessions: sessions,
        total_connections: logs.length
      }, null, 2)
    }]
  };
}

async function getDailyReport(args) {
  const { date } = args;
  console.error(`Getting daily report for ${date}`);
  
  if (!db) await initDatabase();
  
  const query = `
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
  `;

  const employees = await db.all(query, [date]);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        date: date,
        total_employees: employees.length,
        employees: employees
      }, null, 2)
    }]
  };
}

async function getCurrentlyPresent() {
  console.error('Getting currently present employees');
  
  if (!db) await initDatabase();
  
  const query = `
    SELECT 
      device_name,
      MAX(datetime(logged_at, 'localtime')) as last_seen
    FROM wifi_logs
    WHERE logged_at > datetime('now', '-30 minutes')
      AND device_name NOT LIKE '%Unknown%'
    GROUP BY device_name
    ORDER BY last_seen DESC
  `;

  const present = await db.all(query);

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

// Main server setup
async function main() {
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

  // Register handlers using the correct method names
  server.setRequestHandler('tools/list', async () => {
    return {
      tools: [
        {
          name: 'getEmployeePresence',
          description: 'Get detailed in/out times for an employee on a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              employeeName: { 
                type: 'string',
                description: 'Employee name or device name' 
              },
              date: { 
                type: 'string', 
                description: 'Date in YYYY-MM-DD format' 
              }
            },
            required: ['employeeName', 'date']
          }
        },
        {
          name: 'getDailyReport',
          description: 'Get all employees presence for a specific date',
          inputSchema: {
            type: 'object',
            properties: {
              date: { 
                type: 'string', 
                description: 'Date in YYYY-MM-DD format'
              }
            },
            required: ['date']
          }
        },
        {
          name: 'getCurrentlyPresent',
          description: 'Get list of employees currently in the office',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    };
  });

  server.setRequestHandler('tools/call', async (request) => {
    try {
      const { name, arguments: args } = request.params;
      console.error(`Calling tool: ${name}`);
      
      switch (name) {
        case 'getEmployeePresence':
          return await getEmployeePresence(args);
        case 'getDailyReport':
          return await getDailyReport(args);
        case 'getCurrentlyPresent':
          return await getCurrentlyPresent();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      console.error('Error:', error);
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DavaoWifi MCP Server running...');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});