import { can } from '@/domain/permissions';
import type { ID, Layout, Note, User } from '@/domain/types';
import { createId, nowIso } from '@/lib/id';
import { ServiceError, type CreateNoteInput, type NoteRepository } from '../contracts';
import { kv } from './kv';

const notesKey = (layoutId: ID) => `notes:${layoutId}`;
const MAX_LEN = 1000;

/**
 * Notes are stored separately from the layout document: they are written by
 * viewers who can't save the layout, and they map naturally to a `comments`
 * table/endpoint later.
 */
export class LocalNoteRepository implements NoteRepository {
  async list(layoutId: ID): Promise<Note[]> {
    return kv.get<Note[]>(notesKey(layoutId), []);
  }

  async create(actor: User, input: CreateNoteInput): Promise<Note> {
    const text = input.text.trim();
    if (!text) throw new ServiceError('validation', 'Write something first.');
    if (text.length > MAX_LEN) throw new ServiceError('validation', `Notes are limited to ${MAX_LEN} characters.`);
    const note: Note = {
      id: createId('nte'),
      layoutId: input.layoutId,
      authorId: actor.id,
      authorName: actor.displayName,
      text,
      anchor: input.anchor,
      createdAt: nowIso(),
    };
    kv.set(notesKey(input.layoutId), [...(await this.list(input.layoutId)), note]);
    return note;
  }

  async delete(actor: User, layout: Layout, noteId: ID): Promise<void> {
    const notes = await this.list(layout.id);
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    if (!can.deleteNote(actor, layout, note)) throw new ServiceError('forbidden', 'You can’t delete this note.');
    kv.set(
      notesKey(layout.id),
      notes.filter((n) => n.id !== noteId),
    );
  }

  subscribe(layoutId: ID, onChange: (notes: Note[]) => void) {
    return kv.watch(
      (k) => k === notesKey(layoutId),
      () => onChange(kv.get<Note[]>(notesKey(layoutId), [])),
    );
  }
}
