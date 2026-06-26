import crypto from 'node:crypto';
import { env } from '../env.js';

// Stable, unguessable token for the public slip link (so finance can open the slip
// from the Google Sheet without a login). HMAC of the message id + server secret.
export function slipToken(messageId: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`slip:${messageId}`).digest('hex').slice(0, 24);
}

export function buildSlipUrl(base: string, messageId: string): string {
  return `${base}/content/slip/${messageId}?t=${slipToken(messageId)}`;
}
