import type { SupabaseClient } from '@supabase/supabase-js';
import type { ID, Layout, Note, NoteAnchor, User } from '@/domain/types';
import { ServiceError, type CreateNoteInput, type NoteRepository } from '../contracts';
import { isUuid, must } from './client';

interface NoteRow {
  id: string;
  layout_id: string;
  author_id: string;
  author_name: string;
  text: string;
  anchor: NoteAnchor;
  created_at: string;
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  layoutId: r.layout_id,
  authorId: r.author_id,
  authorName: r.author_name,
  text: r.text,
  anchor: r.anchor,
  createdAt: r.created_at,
});

export class SupabaseNoteRepository implements NoteRepository {
  constructor(private sb: SupabaseClient) {}

  async list(layoutId: ID): Promise<Note[]> {
    if (!isUuid(layoutId)) return [];
    const rows = must(await this.sb.from('notes').select('*').eq('layout_id', layoutId).order('created_at'));
    return (rows as NoteRow[]).map(toNote);
  }

  async create(_actor: User, input: CreateNoteInput): Promise<Note> {
    const text = input.text.trim();
    if (!text) throw new ServiceError('validation', 'Write something first.');
    if (text.length > 1000) throw new ServiceError('validation', 'Notes are limited to 1,000 characters.');
    // The author is set on the server from the signed-in account.
    const row = must(
      await this.sb.from('notes').insert({ layout_id: input.layoutId, text, anchor: input.anchor }).select('*').single(),
      'Couldn’t post the note.',
    );
    return toNote(row as NoteRow);
  }

  async delete(_actor: User, _layout: Layout, noteId: ID): Promise<void> {
    const rows = must(await this.sb.from('notes').delete().eq('id', noteId).select('id'));
    if (!rows?.length) throw new ServiceError('forbidden', 'You can’t delete this note.');
  }

  /**
   * Live notes. Deletes can't be filtered by layout in Supabase Realtime, so any
   * note change triggers a fresh read of this layout's notes (RLS applies).
   */
  subscribe(layoutId: ID, onChange: (notes: Note[]) => void) {
    if (!isUuid(layoutId)) return () => {};
    let alive = true;
    const refresh = () =>
      this.list(layoutId)
        .then((n) => alive && onChange(n))
        .catch(() => {});
    const channel = this.sb
      .channel(`notes:${layoutId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `layout_id=eq.${layoutId}` }, refresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, refresh)
      .subscribe();
    return () => {
      alive = false;
      this.sb.removeChannel(channel);
    };
  }
}
