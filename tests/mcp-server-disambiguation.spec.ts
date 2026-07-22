import { test, expect } from '@playwright/test';
import {
  buildDisambiguationMessage,
  countConfiguredMcpServers,
  evaluateMcpCommandBeforeExecute,
  getMatchingServerNames,
  withServerName,
} from '../src/lib/mcp-server-disambiguation';

const MULTI_SERVER_CONFIG = {
  mcpServers: {
    ZohoMCP: { url: 'https://mcp.zoho.com/a' },
    zohocrm: { url: 'https://mcp.zoho.com/a' },
    'Innovate Now MCP': { url: 'https://mcp.zoho.com/a' },
  },
};

const SINGLE_SERVER_CONFIG = {
  mcpServers: {
    zohocrm: { url: 'https://mcp.zoho.com/a' },
  },
};

test.describe('countConfiguredMcpServers / getMatchingServerNames', () => {
  test('counts servers in mcpServers map', () => {
    expect(countConfiguredMcpServers(MULTI_SERVER_CONFIG)).toBe(3);
    expect(countConfiguredMcpServers(SINGLE_SERVER_CONFIG)).toBe(1);
  });

  test('getMatchingServerNames returns distinct server names for a tool', () => {
    const tools = [
      { name: 'ZohoCRM_createModule', serverName: 'ZohoMCP' },
      { name: 'ZohoCRM_createModule', serverName: 'zohocrm' },
      { name: 'ZohoCRM_getModules', serverName: 'zohocrm' },
    ];
    expect(getMatchingServerNames(tools, 'ZohoCRM_createModule')).toEqual(['ZohoMCP', 'zohocrm']);
  });
});

test.describe('evaluateMcpCommandBeforeExecute', () => {
  test('single-server project skips listAllMCPTools entirely', async () => {
    let listToolsCalled = false;
    const mockListTools = async () => {
      listToolsCalled = true;
      return [];
    };

    const decision = await evaluateMcpCommandBeforeExecute(
      SINGLE_SERVER_CONFIG,
      { action: 'ZohoCRM_createModule', moduleName: 'Leads' },
      'project-1',
      mockListTools
    );

    expect(listToolsCalled).toBe(false);
    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.command).toEqual({ action: 'ZohoCRM_createModule', moduleName: 'Leads' });
    }
  });

  test('multi-server ambiguous tool triggers disambiguation question', async () => {
    const mockListTools = async () => [
      { name: 'ZohoCRM_createModule', serverName: 'ZohoMCP' },
      { name: 'ZohoCRM_createModule', serverName: 'zohocrm' },
    ];

    const decision = await evaluateMcpCommandBeforeExecute(
      MULTI_SERVER_CONFIG,
      { action: 'ZohoCRM_createModule', moduleName: 'Leads' },
      'project-1',
      mockListTools
    );

    expect(decision.execute).toBe(false);
    if (!decision.execute) {
      expect(decision.disambiguationMessage).toContain('**ZohoMCP**');
      expect(decision.disambiguationMessage).toContain('**zohocrm**');
      expect(decision.disambiguationMessage).toContain('not been executed yet');
      expect(decision.disambiguationMessage).toContain('ZohoCRM_createModule');
    }
  });

  test('multi-server tool on one server only auto-executes with serverName injected', async () => {
    const mockListTools = async () => [
      { name: 'ZohoCRM_createModule', serverName: 'zohocrm' },
      { name: 'ZohoCRM_getModules', serverName: 'ZohoMCP' },
    ];

    const decision = await evaluateMcpCommandBeforeExecute(
      MULTI_SERVER_CONFIG,
      { action: 'ZohoCRM_createModule', moduleName: 'Leads', profiles: ['p1'] },
      'project-1',
      mockListTools
    );

    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.command).toEqual({
        action: 'ZohoCRM_createModule',
        moduleName: 'Leads',
        profiles: ['p1'],
        serverName: 'zohocrm',
      });
    }
  });

  test('skips ambiguity check when serverName is already set', async () => {
    let listToolsCalled = false;
    const mockListTools = async () => {
      listToolsCalled = true;
      return [];
    };

    const original = {
      action: 'ZohoCRM_createModule',
      serverName: 'zohocrm',
      moduleName: 'Leads',
    };

    const decision = await evaluateMcpCommandBeforeExecute(
      MULTI_SERVER_CONFIG,
      original,
      'project-1',
      mockListTools
    );

    expect(listToolsCalled).toBe(false);
    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.command).toEqual(original);
    }
  });

  test('list_tools bypasses ambiguity check without listing', async () => {
    let listToolsCalled = false;
    const mockListTools = async () => {
      listToolsCalled = true;
      return [];
    };

    const decision = await evaluateMcpCommandBeforeExecute(
      MULTI_SERVER_CONFIG,
      { action: 'list_tools' },
      'project-1',
      mockListTools
    );

    expect(listToolsCalled).toBe(false);
    expect(decision.execute).toBe(true);
  });

  test('tool not found on any server executes unchanged without disambiguation', async () => {
    const mockListTools = async () => [
      { name: 'ZohoCRM_getModules', serverName: 'ZohoMCP' },
      { name: 'ZohoCRM_getModules', serverName: 'zohocrm' },
    ];

    const original = {
      action: 'ZohoCRM_createModule',
      moduleName: 'Leads',
      profiles: ['p1'],
    };

    const decision = await evaluateMcpCommandBeforeExecute(
      MULTI_SERVER_CONFIG,
      original,
      'project-1',
      mockListTools
    );

    expect(decision.execute).toBe(true);
    if (decision.execute) {
      expect(decision.command).toEqual(original);
      expect(decision.command).not.toHaveProperty('serverName');
    }
  });
});

test.describe('withServerName / re-issued commands', () => {
  test('preserves original tool arguments when adding serverName', () => {
    const original = {
      action: 'ZohoCRM_createModule',
      moduleName: 'Leads',
      profiles: ['profile-id-1', 'profile-id-2'],
      description: 'Custom module for leads',
    };

    expect(withServerName(original, 'zohocrm')).toEqual({
      action: 'ZohoCRM_createModule',
      moduleName: 'Leads',
      profiles: ['profile-id-1', 'profile-id-2'],
      description: 'Custom module for leads',
      serverName: 'zohocrm',
    });
  });

  test('buildDisambiguationMessage uses bold exact server names', () => {
    const message = buildDisambiguationMessage('ZohoCRM_createModule', ['ZohoMCP', 'zohocrm']);
    expect(message).toContain('**ZohoMCP**');
    expect(message).toContain('**zohocrm**');
    expect(message).toContain('not been executed yet');
  });
});
