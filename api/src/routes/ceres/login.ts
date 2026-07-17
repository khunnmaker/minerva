import type { FastifyInstance } from 'fastify';
import { buildLoginCards } from '../../auth/loginCards.js';
import { env } from '../../env.js';

export function ceresLocalLoginEnabled(value = env.CERES_LOCAL_LOGIN_ENABLED): boolean {
  return ['1', 'true'].includes(value.trim().toLowerCase());
}

type LoginRouteOptions = {
  enabled?: () => boolean;
  buildCards?: typeof buildLoginCards;
};

// Compatibility-only account-card list for Ceres's explicit ?local=1 break-glass path.
// Keep registration stable for one release, but make the disabled state indistinguishable
// from a removed endpoint so normal clients cannot discover or use the legacy surface.
export function ceresLoginRoute(app: FastifyInstance, options: LoginRouteOptions = {}): void {
  const enabled = options.enabled ?? ceresLocalLoginEnabled;
  const buildCards = options.buildCards ?? buildLoginCards;
  app.get('/api/ceres/logins', async (_req, reply) => {
    if (!enabled()) return reply.code(404).send({ error: 'not_found' });
    return buildCards('ceres');
  });
}
