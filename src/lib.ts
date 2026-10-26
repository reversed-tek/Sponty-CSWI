import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const configured = /^https:\/\//.test(url) && key.length > 10;
export const supabase = createClient(
  configured ? url : 'https://not-configured.invalid',
  configured ? key : 'not-configured',
  { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }
);
export type Role = 'requestor' | 'approver' | 'admin';
export type Status = 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type Request = {
  id: string; reference: string; created_by: string; approver_id: string | null;
  title: string; description: string; department: string; location: string;
  starts_at: string | null; ends_at: string | null; participant_count: number;
  equipment: string; bus_required: boolean; bus_passengers: number;
  transport_notes: string; notes: string; status: Status; resource_status: string;
  resource_notes: string; created_at: string; updated_at:string; activity_type:'general'|'bus_trip'|'off_site'; checklist_answers: Record<string, boolean | number>;
};
export type Document = { id:string; request_id:string; file_name:string; storage_path:string; mime_type:string; evidence_kind:'supporting'|'completion'; created_at:string };
export type Event = { id:number; request_id:string; actor_id:string; event:string; detail:string; created_at:string };
export type Comment = { id:string; request_id:string; author_id:string; body:string; internal:boolean; created_at:string };
export type DocumentRequest = { id:string; request_id:string; prompt:string; resolved_at:string | null; created_at:string };
export type AppNotification = { id:number; request_id:string|null; subject:string; body:string; created_at:string; read_at:string|null };
/**
 * Supabase and PostgREST failures can be plain objects rather than Error instances.
 * String(object) displays "[object Object]", hiding the actual problem from users.
 */
export function errorText(error: unknown): string {
  const fallback = 'An unexpected error occurred. Please try again.';

  if (typeof error === 'string') {
    const message = error.trim();
    return message && message !== '[object Object]' ? message : fallback;
  }
  if (error instanceof Error) {
    return errorText(error.message);
  }
  if (error && typeof error === 'object') {
    const fields = error as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'details', 'hint', 'code']) {
      const value = fields[key];
      if (typeof value === 'string' && value.trim() && value.trim() !== '[object Object]') {
        return value.trim();
      }
    }
  }
  return fallback;
}
