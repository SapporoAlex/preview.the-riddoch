import type { SupabaseClient } from '@supabase/supabase-js';
import type { ID, Layout, Share, User } from '@/domain/types';
import { ServiceError, type ShareService } from '../contracts';
import { must } from './client';

interface ShareRow {
  id: string;
  layout_id: string;
  owner_id: string;
  recipient_id: string;
  recipient_email: string;
  permission: 'view';
  created_at: string;
}

const toShare = (r: ShareRow): Share => ({
  id: r.id,
  layoutId: r.layout_id,
  ownerId: r.owner_id,
  recipientId: r.recipient_id,
  recipientEmail: r.recipient_email,
  permission: r.permission,
  createdAt: r.created_at,
});

export class SupabaseShareService implements ShareService {
  constructor(private sb: SupabaseClient) {}

  async listForLayout(layoutId: ID): Promise<Share[]> {
    const rows = must(await this.sb.from('shares').select('*').eq('layout_id', layoutId).order('created_at'));
    return (rows as ShareRow[]).map(toShare);
  }

  async listSharedWith(userId: ID): Promise<Share[]> {
    const rows = must(await this.sb.from('shares').select('*').eq('recipient_id', userId));
    return (rows as ShareRow[]).map(toShare);
  }

  async getAccess(userId: ID, layout: Layout) {
    if (layout.ownerId === userId) return 'owner' as const;
    const rows = must(
      await this.sb.from('shares').select('id').eq('layout_id', layout.id).eq('recipient_id', userId).limit(1),
    );
    return rows?.length ? ('viewer' as const) : ('none' as const);
  }

  /** Runs on the server (share_layout) so the client never sees other accounts. */
  async share(_actor: User, layoutId: ID, recipientEmail: string): Promise<Share> {
    const email = recipientEmail.trim();
    if (!email) throw new ServiceError('validation', 'Enter an email address.');
    const row = must(await this.sb.rpc('share_layout', { p_layout: layoutId, p_email: email }), 'Couldn’t share the layout.');
    return toShare(row as ShareRow);
  }

  async revoke(_actor: User, shareId: ID): Promise<void> {
    const rows = must(await this.sb.from('shares').delete().eq('id', shareId).select('id'));
    if (!rows?.length) throw new ServiceError('forbidden', 'Only the owner can remove access.');
  }
}
