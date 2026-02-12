import { getSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  type IntegrationType,
  deleteIntegration,
  getIntegration,
  saveIntegration,
  toggleIntegration,
} from '@/services/integrations';
import { createApiResponse } from '@/utils/create-api-response';
import { z } from 'zod';

const DOMAIN = '/api/integrations/[type]';

const VALID_TYPES = ['gmail', 'calendar'] as const;

function isValidType(type: string): type is IntegrationType {
  return VALID_TYPES.includes(type as IntegrationType);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const { type } = await params;

    if (!isValidType(type)) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid integration type',
      });
    }

    const integration = await getIntegration(session.userId, type);

    return createApiResponse({
      code: '200-success',
      data: {
        exists: integration.exists,
        enabled: integration.enabled,
      },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error fetching integration');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}

const SAVE_INTEGRATION_SCHEMA = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  scope: z.string(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const { type } = await params;

    if (!isValidType(type)) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid integration type',
      });
    }

    const body = await request.json();
    const parsed = SAVE_INTEGRATION_SCHEMA.safeParse(body);

    if (!parsed.success) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid credentials format',
      });
    }

    await saveIntegration(session.userId, type, parsed.data);

    return createApiResponse({
      code: '200-success',
      data: { saved: true },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error saving integration');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}

const TOGGLE_SCHEMA = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const { type } = await params;

    if (!isValidType(type)) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid integration type',
      });
    }

    const body = await request.json();
    const parsed = TOGGLE_SCHEMA.safeParse(body);

    if (!parsed.success) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid request body',
      });
    }

    const success = await toggleIntegration(
      session.userId,
      type,
      parsed.data.enabled,
    );

    if (!success) {
      return createApiResponse({
        code: '404-not-found',
        publicFacingMessage: 'Integration not found',
      });
    }

    return createApiResponse({
      code: '200-success',
      data: { enabled: parsed.data.enabled },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error toggling integration');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const session = await getSession();

    if (!session) {
      return createApiResponse({
        code: '401-unauthorized',
        publicFacingMessage: 'Not authenticated',
      });
    }

    const { type } = await params;

    if (!isValidType(type)) {
      return createApiResponse({
        code: '400-bad-request',
        publicFacingMessage: 'Invalid integration type',
      });
    }

    const success = await deleteIntegration(session.userId, type);

    if (!success) {
      return createApiResponse({
        code: '404-not-found',
        publicFacingMessage: 'Integration not found',
      });
    }

    return createApiResponse({
      code: '200-success',
      data: { deleted: true },
    });
  } catch (error) {
    logger.error({ error, domain: DOMAIN }, 'Error deleting integration');
    return createApiResponse({
      code: '500-internal-server-error',
      publicFacingMessage: 'An unexpected error occurred',
    });
  }
}
