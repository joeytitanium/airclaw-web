import { logger } from './logger';

const FLY_API_URL = 'https://api.machines.dev/v1';

interface FlyMachineConfig {
  image: string;
  env?: Record<string, string>;
  auto_destroy?: boolean;
  restart?: {
    policy: 'no' | 'on-failure' | 'always';
  };
  services?: Array<{
    ports: Array<{
      port: number;
      handlers: string[];
    }>;
    protocol: string;
    internal_port: number;
    autostart?: boolean;
    autostop?: boolean;
    min_machines_running?: number;
  }>;
  guest?: {
    cpu_kind: string;
    cpus: number;
    memory_mb: number;
  };
}

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip: string;
  config: FlyMachineConfig;
  created_at: string;
  updated_at: string;
}

interface CreateMachineRequest {
  name?: string;
  region?: string;
  config: FlyMachineConfig;
}

class FlyClient {
  private token: string;
  private appName: string;

  constructor() {
    const token = process.env.FLY_API_TOKEN;
    const appName = process.env.FLY_APP_NAME;

    if (!token) {
      throw new Error('FLY_API_TOKEN environment variable is not set');
    }
    if (!appName) {
      throw new Error('FLY_APP_NAME environment variable is not set');
    }

    this.token = token;
    this.appName = appName;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${FLY_API_URL}/apps/${this.appName}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText, url, method },
        'Fly API request failed',
      );
      throw new Error(`Fly API error: ${response.status} - ${errorText}`);
    }

    // Some endpoints return empty response
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  async createMachine(request: CreateMachineRequest): Promise<FlyMachine> {
    return this.request<FlyMachine>('POST', '/machines', request);
  }

  async getMachine(machineId: string): Promise<FlyMachine> {
    return this.request<FlyMachine>('GET', `/machines/${machineId}`);
  }

  async startMachine(machineId: string): Promise<void> {
    await this.request<void>('POST', `/machines/${machineId}/start`);
  }

  async stopMachine(machineId: string): Promise<void> {
    await this.request<void>('POST', `/machines/${machineId}/stop`);
  }

  async deleteMachine(machineId: string): Promise<void> {
    await this.request<void>('DELETE', `/machines/${machineId}?force=true`);
  }

  async listMachines(): Promise<FlyMachine[]> {
    return this.request<FlyMachine[]>('GET', '/machines');
  }

  async waitForState(
    machineId: string,
    targetState: string,
    timeoutMs = 60000,
  ): Promise<FlyMachine> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const machine = await this.getMachine(machineId);
      if (machine.state === targetState) {
        return machine;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `Timeout waiting for machine ${machineId} to reach state ${targetState}`,
    );
  }
}

let flyClient: FlyClient | null = null;

export function createFlyClient(): FlyClient {
  if (!flyClient) {
    flyClient = new FlyClient();
  }
  return flyClient;
}

export type { FlyMachine, FlyMachineConfig, CreateMachineRequest };
