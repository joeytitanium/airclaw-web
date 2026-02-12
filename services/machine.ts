import { db } from '@/db';
import { machines } from '@/db/schema';
import { type FlyMachine, createFlyClient } from '@/lib/fly';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';

const OPENCLAW_IMAGE =
  process.env.OPENCLAW_IMAGE || 'registry.fly.io/airclaw-dev:v4';

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

  // Reset stuck states when there's no Fly machine to back them
  if (!machine.machineId && machine.status !== 'stopped') {
    const [updated] = await db
      .update(machines)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(machines.id, machine.id))
      .returning();
    machine = updated;
  }

  // If we have a Fly machine ID, get its current status
  if (machine.machineId) {
    try {
      const fly = createFlyClient();
      const flyMachine = await fly.getMachine(machine.machineId);

      // If the machine was destroyed, clear it so we create a new one
      if (flyMachine.state === 'destroyed') {
        const [updated] = await db
          .update(machines)
          .set({ machineId: null, status: 'stopped', updatedAt: new Date() })
          .where(eq(machines.id, machine.id))
          .returning();
        machine = updated;
        return { machine, flyMachine: null };
      }

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
      logger.error(
        { error, machineId: machine.machineId },
        'Failed to get Fly machine',
      );
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

  try {
    if (flyMachine) {
      // Start existing machine
      await fly.startMachine(flyMachine.id);
      resultMachine = await fly.waitForState(flyMachine.id, 'started');
    } else {
      const machineName = `openclaw-${userId.slice(0, 8)}`;

      try {
        // Create new Fly machine
        resultMachine = await fly.createMachine({
          name: machineName,
          config: {
            image: OPENCLAW_IMAGE,
            env: {
              USER_ID: userId,
              BACKEND_URL: process.env.AUTH_URL || 'http://localhost:3000',
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
              MACHINE_SECRET: process.env.MACHINE_SECRET || '',
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
              memory_mb: 2048,
            },
          },
        });
      } catch (createError) {
        // Handle name conflict (409) — find existing machine by name
        if (String(createError).includes('already_exists')) {
          logger.info(
            { machineName },
            'Machine name conflict, looking up existing machine',
          );
          const allMachines = await fly.listMachines();
          const existing = allMachines.find((m) => m.name === machineName);
          if (existing) {
            if (existing.state !== 'started') {
              await fly.startMachine(existing.id);
            }
            resultMachine = await fly.waitForState(existing.id, 'started');
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }

      // Wait for machine to reach started state
      resultMachine = await fly.waitForState(resultMachine.id, 'started');
    }
  } catch (error) {
    // Reset status on failure so it doesn't get stuck in "starting"
    await db
      .update(machines)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(machines.id, machine.id));
    throw error;
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
  status: (typeof machines.$inferSelect)['status'];
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
): (typeof machines.$inferSelect)['status'] {
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
