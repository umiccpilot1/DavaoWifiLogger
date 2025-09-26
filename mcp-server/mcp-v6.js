#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Open database
const dbPath = path.join(__dirname, '..', 'database.sqlite');
console.error(`Opening database: ${dbPath}`);
const db = new Database(dbPath);

// Create server with handlers passed directly
const server = new Server(
  {
    name: "davao-wifi-logger",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool list handler
server.setRequestHandler("ListToolsRequest", async () => ({
  tools: [
    {
      name: "check_presence",
      description: "Check employee presence for a specific date",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Employee name",
          },
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format",
          },
        },
        required: ["name", "date"],
      },
    },
    {
      name: "daily_report",
      description: "Get all employees for a specific date",
      inputSchema: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format",
          },
        },
        required: ["date"],
      },
    },
    {
      name: "current_status",
      description: "Get currently present employees",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// Tool call handler
server.setRequestHandler("CallToolRequest", async (request) => {
  const { name, arguments: args } = request.params;
  console.error(`Calling tool: ${name}`);

  try {
    if (name === "check_presence") {
      const stmt = db.prepare(`
        SELECT 
          device_name,
          datetime(logged_at, 'localtime') as connection_time
        FROM wifi_logs
        WHERE device_name LIKE ?
          AND date(logged_at, 'localtime') = ?
        ORDER BY logged_at
      `);
      
      const logs = stmt.all(`%${args.name}%`, args.date);
      
      if (logs.length === 0) {
        return {
          toolResult: {
            content: [
              {
                type: "text",
                text: `No logs found for ${args.name} on ${args.date}`,
              },
            ],
          },
        };
      }

      // Process into sessions (30-minute gap = new session)
      const sessions = [];
      let currentSession = null;
      
      for (let i = 0; i < logs.length; i++) {
        const current = logs[i];
        const prev = logs[i - 1];
        
        let isNewSession = !prev;
        if (prev) {
          const prevTime = new Date(prev.connection_time);
          const currTime = new Date(current.connection_time);
          const gapMinutes = (currTime - prevTime) / (1000 * 60);
          isNewSession = gapMinutes > 30;
        }
        
        if (isNewSession) {
          if (currentSession) {
            sessions.push(currentSession);
          }
          currentSession = {
            in_time: current.connection_time,
            out_time: current.connection_time,
          };
        } else {
          currentSession.out_time = current.connection_time;
        }
      }
      
      if (currentSession) {
        sessions.push(currentSession);
      }

      // Calculate total hours
      let totalMinutes = 0;
      sessions.forEach(session => {
        const inTime = new Date(session.in_time);
        const outTime = new Date(session.out_time);
        totalMinutes += (outTime - inTime) / (1000 * 60);
      });

      const result = {
        employee: logs[0].device_name,
        date: args.date,
        sessions: sessions,
        total_hours: (totalMinutes / 60).toFixed(2),
        total_connections: logs.length,
      };

      return {
        toolResult: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    }

    if (name === "daily_report") {
      const stmt = db.prepare(`
        SELECT 
          device_name,
          MIN(datetime(logged_at, 'localtime')) as first_in,
          MAX(datetime(logged_at, 'localtime')) as last_out,
          COUNT(*) as connections
        FROM wifi_logs
        WHERE date(logged_at, 'localtime') = ?
          AND device_name NOT LIKE '%Unknown%'
          AND device_name NOT LIKE '%anonymous%'
        GROUP BY device_name
        ORDER BY first_in
      `);
      
      const employees = stmt.all(args.date);

      return {
        toolResult: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                date: args.date,
                total_employees: employees.length,
                employees: employees,
              }, null, 2),
            },
          ],
        },
      };
    }

    if (name === "current_status") {
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
        toolResult: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                timestamp: new Date().toISOString(),
                count: present.length,
                employees: present,
              }, null, 2),
            },
          ],
        },
      };
    }

    return {
      toolResult: {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
      },
    };
  } catch (error) {
    console.error("Tool error:", error);
    return {
      toolResult: {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      },
    };
  }
});

// Run server
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Davao WiFi MCP Server running (v0.6.0)");
}

run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});