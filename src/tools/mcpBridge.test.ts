import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpBridge } from './mcpBridge.js';
import type { OpenAIToolDefinition } from './nvidiaSkills.js';

describe('MCP Bridge Suite', () => {
  it('registers MCP servers and statically defined tools', () => {
    const bridge = new McpBridge();
    const testTool: OpenAIToolDefinition = {
      type: 'function',
      function: {
        name: 'query_db',
        description: 'Query database via MCP',
        parameters: {
          type: 'object',
          properties: { sql: { type: 'string', description: 'SQL query to execute' } },
          required: ['sql'],
          additionalProperties: false,
        },
      },
    };

    bridge.registerServer('postgres', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      tools: [testTool],
    });

    const servers = bridge.getServers();
    assert.strictEqual(servers.length, 1);
    assert.strictEqual(servers[0].name, 'postgres');
    assert.strictEqual(servers[0].toolCount, 1);

    assert.strictEqual(bridge.hasTool('query_db'), true);
    const defs = bridge.getToolDefinitions();
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].function.name, 'query_db');
  });

  it('loads MCP configuration from workspace directory .machcode/mcp.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-config-'));
    try {
      const mcpDir = path.join(tmp, '.machcode');
      await fs.mkdir(mcpDir, { recursive: true });
      await fs.writeFile(
        path.join(mcpDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', tmp],
            },
          },
        }),
        'utf-8',
      );

      const bridge = new McpBridge();
      const res = await bridge.loadConfig(tmp);
      assert.strictEqual(res.loaded, true);
      assert.strictEqual(res.serverCount, 1);

      const servers = bridge.getServers();
      assert.strictEqual(servers[0].name, 'filesystem');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('executes MCP tool handler with provided arguments', async () => {
    const bridge = new McpBridge();
    const mockTool: OpenAIToolDefinition = {
      type: 'function',
      function: {
        name: 'fetch_weather',
        description: 'Fetch weather report',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name to query weather for' } },
          required: ['city'],
          additionalProperties: false,
        },
      },
    };

    bridge.registerTool('weather-server', mockTool, async (args) => {
      return {
        output: `Temperature in ${args.city} is 22C`,
        summary: `Weather for ${args.city}`,
      };
    });

    assert.strictEqual(bridge.hasTool('fetch_weather'), true);
    const outcome = await bridge.executeTool('fetch_weather', { city: 'Istanbul' }, { cwd: '.' });
    assert.ok(outcome.output.includes('Istanbul'));
    assert.ok(outcome.output.includes('22C'));
    assert.strictEqual(outcome.summary, 'Weather for Istanbul');
  });
});
