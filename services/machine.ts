import { db } from '@/db';
import { machines } from '@/db/schema';
import { createFlyClient, type FlyMachine } from '@/lib/fly';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';

const OPENCLAW_IMAGE = 'registry.fly.io/pocketclaw-openclaw:latest';

export async function getOrCreateMachine(userId: string): Promise<{
  machine: typeof machines.$inferSelect;
  flyMachine: FlyMachine | null;
}> {
  // Check if user already has a machine record
  let machine = await db.query.machines.findFirst({
    where: eq(machines.userId, userId),
  });

  if (!machine) {
    // Create machine record in database
    const [newMachine] = await db
      .insert(machines)
      .values({
        userId,
        status: 'stopped',
      })
      .returning();
    machine = newMachine;
  }

  // If we have a Fly machine ID, get its current status
  if (machine.machineId) {
    try {
      const fly = createFlyClient();
      const flyMachine = await fly.getMachine(machine.machineId);

      // Sync status with Fly
      const status = mapFlyStateToStatus(flyMachine.state);
      if (status !== machine.status) {
        const [updated] = await db
          .update(machines)
          .set({ status, updatedAt: new Date() })
          .where(eq(machines.id, machine.id))
          .returning();
        machine = updated;
      }

      return { machine, flyMachine };
    } catch (error) {
      logger.error({ error, machineId: machine.machineId }, 'Failed to get Fly machine');
      // Machine might have been deleted, clear the ID
      const [updated] = await db
        .update(machines)
        .set({ machineId: null, status: 'stopped', updatedAt: new Date() })
        .where(eq(machines.id, machine.id))
        .returning();
      machine = updated;
    }
  }

  return { machine, flyMachine: null };
}

export async function startMachine(userId: string): Promise<{
  machine: typeof machines.$inferSelect;
  flyMachine: FlyMachine;
}> {
  const fly = createFlyClient();
  const { machine, flyMachine } = await getOrCreateMachine(userId);

  // If machine is already running, return it
  if (flyMachine && flyMachine.state === 'started') {
    return { machine, flyMachine };
  }

  // Update status to starting
  await db
    .update(machines)
    .set({ status: 'starting', updatedAt: new Date() })
    .where(eq(machines.id, machine.id));

  let resultMachine: FlyMachine;

  if (flyMachine) {
    // Start existing machine
    await fly.startMachine(flyMachine.id);
    resultMachine = await fly.waitForState(flyMachine.id, 'started');
  } else {
    // Create new Fly machine
    resultMachine = await fly.createMachine({
      name: `openclaw-${userId.slice(0, 8)}`,
      config: {
        image: OPENCLAW_IMAGE,
        env: {
          USER_ID: userId,
          BACKEND_URL: process.env.AUTH_URL || 'http://localhost:3000',
        },
        auto_destroy: false,
        restart: { policy: 'no' },
        services: [
          {
            ports: [{ port: 443, handlers: ['tls', 'http'] }],
            protocol: 'tcp',
            internal_port: 8080,
            autostart: true,
            autostop: true,
            min_machines_running: 0,
          },
        ],
        guest: {
          cpu_kind: 'shared',
          cpus: 1,
          memory_mb: 256,
        },
      },
    });

    // Wait for machine to start
    resultMachine = await fly.waitForState(resultMachine.id, 'started');
  }

  // Update database with machine ID and status
  const [updatedMachine] = await db
    .update(machines)
    .set({
      machineId: resultMachine.id,
      status: 'running',
      updatedAt: new Date(),
    })
    .where(eq(machines.id, machine.id))
    .returning();

  return { machine: updatedMachine, flyMachine: resultMachine };
}

export async function stopMachine(userId: string): Promise<void> {
  const { machine, flyMachine } = await getOrCreateMachine(userId);

  if (!flyMachine) {
    return; // No machine to stop
  }

  if (flyMachine.state === 'stopped') {
    return; // Already stopped
  }

  const fly = createFlyClient();

  // Update status to stopping
  await db
    .update(machines)
    .set({ status: 'stopping', updatedAt: new Date() })
    .where(eq(machines.id, machine.id));

  await fly.stopMachine(flyMachine.id);
  await fly.waitForState(flyMachine.id, 'stopped');

  // Update database status
  await db
    .update(machines)
    .set({ status: 'stopped', updatedAt: new Date() })
    .where(eq(machines.id, machine.id));
}

export async function getMachineStatus(userId: string): Promise<{
  status: typeof machines.$inferSelect['status'];
  machineId: string | null;
  privateIp: string | null;
}> {
  const { machine, flyMachine } = await getOrCreateMachine(userId);

  return {
    status: machine.status,
    machineId: machine.machineId,
    privateIp: flyMachine?.private_ip ?? null,
  };
}

export async function upgradeMachine(userId: string): Promise<void> {
  // Stop the machine, which will cause it to start fresh with the latest image
  await stopMachine(userId);

  // Delete the Fly machine so next start creates a new one with latest image
  const { machine, flyMachine } = await getOrCreateMachine(userId);

  if (flyMachine) {
    const fly = createFlyClient();
    await fly.deleteMachine(flyMachine.id);

    // Clear machine ID so next start creates a new machine
    await db
      .update(machines)
      .set({ machineId: null, updatedAt: new Date() })
      .where(eq(machines.id, machine.id));
  }
}

function mapFlyStateToStatus(
  flyState: string,
): typeof machines.$inferSelect['status'] {
  switch (flyState) {
    case 'started':
      return 'running';
    case 'starting':
      return 'starting';
    case 'stopping':
      return 'stopping';
    case 'stopped':
    case 'destroyed':
      return 'stopped';
    default:
      return 'error';
  }
}
