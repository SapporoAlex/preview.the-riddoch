import type { ID, Layout, Share, User } from '@/domain/types';
import { createId, nowIso } from '@/lib/id';
import { ServiceError, type ShareService, type UserDirectory } from '../contracts';
import { kv, latency } from './kv';

const SHARES_KEY = 'shares';

/**
 * PROTOTYPE: sharing works between accounts created in this same browser.
 * Open a second tab (or a private window won't work — it has separate
 * storage) and sign in as the recipient to see the shared layout.
 */
export class LocalShareService implements ShareService {
  constructor(private users: UserDirectory) {}

  private all(): Share[] {
    return kv.get<Share[]>(SHARES_KEY, []);
  }

  async listForLayout(layoutId: ID): Promise<Share[]> {
    return this.all().filter((s) => s.layoutId === layoutId);
  }

  async listSharedWith(userId: ID): Promise<Share[]> {
    await latency();
    return this.all().filter((s) => s.recipientId === userId);
  }

  async getAccess(userId: ID, layout: Layout) {
    if (layout.ownerId === userId) return 'owner' as const;
    return this.all().some((s) => s.layoutId === layout.id && s.recipientId === userId)
      ? ('viewer' as const)
      : ('none' as const);
  }

  async share(actor: User, layoutId: ID, recipientEmail: string): Promise<Share> {
    await latency(150);
    const layout = kv.get<Layout | null>(`layout:${layoutId}`, null);
    if (!layout) throw new ServiceError('not_found', 'That layout no longer exists.');
    if (layout.ownerId !== actor.id) throw new ServiceError('forbidden', 'Only the owner can share this layout.');
    const recipient = await this.users.findByEmail(recipientEmail);
    if (!recipient) {
      throw new ServiceError(
        'not_found',
        'No account uses that email yet. In this prototype the recipient must sign up in this browser first.',
      );
    }
    if (recipient.id === actor.id) throw new ServiceError('validation', "You can't share a layout with yourself.");
    const all = this.all();
    const existing = all.find((s) => s.layoutId === layoutId && s.recipientId === recipient.id);
    if (existing) return existing;
    const share: Share = {
      id: createId('shr'),
      layoutId,
      ownerId: actor.id,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      permission: 'view',
      createdAt: nowIso(),
    };
    kv.set(SHARES_KEY, [...all, share]);
    return share;
  }

  async revoke(actor: User, shareId: ID): Promise<void> {
    const all = this.all();
    const s = all.find((x) => x.id === shareId);
    if (!s) return;
    if (s.ownerId !== actor.id) throw new ServiceError('forbidden', 'Only the owner can revoke access.');
    kv.set(
      SHARES_KEY,
      all.filter((x) => x.id !== shareId),
    );
  }
}
