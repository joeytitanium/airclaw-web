import { db } from '@/db';
import { integrations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, decrypt } from '@/lib/encryption';

export type IntegrationType = 'gmail' | 'calendar';

interface IntegrationCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

export async function getIntegrations(
  userId: string,
): Promise<Array<{ type: string; enabled: boolean; createdAt: Date }>> {
  const userIntegrations = await db.query.integrations.findMany({
    where: eq(integrations.userId, userId),
  });

  return userIntegrations.map((i) => ({
    type: i.type,
    enabled: i.enabled,
    createdAt: i.createdAt,
  }));
}

export async function getIntegration(
  userId: string,
  type: IntegrationType,
): Promise<{
  exists: boolean;
  enabled: boolean;
  credentials?: IntegrationCredentials;
}> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.type, type),
    ),
  });

  if (!integration) {
    return { exists: false, enabled: false };
  }

  const credentials = JSON.parse(
    decrypt(integration.credentials),
  ) as IntegrationCredentials;

  return {
    exists: true,
    enabled: integration.enabled,
    credentials,
  };
}

export async function saveIntegration(
  userId: string,
  type: IntegrationType,
  credentials: IntegrationCredentials,
): Promise<void> {
  const encryptedCredentials = encrypt(JSON.stringify(credentials));

  const existing = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.type, type),
    ),
  });

  if (existing) {
    await db
      .update(integrations)
      .set({
        credentials: encryptedCredentials,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values({
      userId,
      type,
      credentials: encryptedCredentials,
      enabled: true,
    });
  }
}

export async function toggleIntegration(
  userId: string,
  type: IntegrationType,
  enabled: boolean,
): Promise<boolean> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.type, type),
    ),
  });

  if (!integration) {
    return false;
  }

  await db
    .update(integrations)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(integrations.id, integration.id));

  return true;
}

export async function deleteIntegration(
  userId: string,
  type: IntegrationType,
): Promise<boolean> {
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.type, type),
    ),
  });

  if (!integration) {
    return false;
  }

  await db.delete(integrations).where(eq(integrations.id, integration.id));

  return true;
}

export async function getDecryptedCredentials(
  userId: string,
  type: IntegrationType,
): Promise<IntegrationCredentials | null> {
  const { exists, credentials } = await getIntegration(userId, type);

  if (!exists || !credentials) {
    return null;
  }

  return credentials;
}
