import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/** Vercel Cron: optional email delivery, with service-side credentials only. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error:'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error:'Unauthorized' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFICATION_FROM } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !NOTIFICATION_FROM)
    return res.status(503).json({ error:'Server-side email settings are incomplete' });
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false, autoRefreshToken:false} });
  const { error: reminderError } = await db.rpc('queue_daily_reminders');
  if (reminderError) return res.status(500).json({ error: reminderError.message });
  const { data, error } = await db.rpc('claim_notifications', { n: 25 });
  if (error) return res.status(500).json({ error:error.message });
  let sent=0, failed=0;
  for (const notification of data || []) {
    try {
      const { data: profile, error: profileError } = await db.from('profiles').select('email').eq('id',notification.user_id).single();
      if (profileError || !profile?.email) throw new Error('Recipient profile not found');
      const r = await fetch('https://api.resend.com/emails',{
        method:'POST', headers:{
          Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json',
          'Idempotency-Key':'cswi-notification-'+notification.id
        }, body:JSON.stringify({ from: NOTIFICATION_FROM, to:[profile.email],
           subject:notification.subject, text:notification.body + '\n\nSign in to Sponty CSWI to review this request.' })
      });
      if (!r.ok) throw new Error('Email provider HTTP '+r.status);
      const { error: markError }=await db.rpc('finish_notification',{nid:notification.id,delivered:true,failure:null});
      if (markError) throw markError;
      sent++;
    } catch(e) {
      failed++;
      await db.rpc('finish_notification',{nid:notification.id,delivered:false,failure:e instanceof Error ? e.message : String(e)});
    }
  }
  return res.status(200).json({processed:(data || []).length,sent,failed});
}
