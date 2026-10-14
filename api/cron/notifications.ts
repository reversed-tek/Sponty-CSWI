import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/** Service-only Vercel Cron. Claims up to 100 notifications atomically and
 * sends with bounded concurrency; individual delivery keeps its idempotency key.
 * The schedule remains daily for compatibility with Vercel Hobby accounts. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFICATION_FROM } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !NOTIFICATION_FROM)
    return res.status(503).json({ error: 'Server-side email settings are incomplete' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: reminderError } = await db.rpc('queue_daily_reminders');
  if (reminderError) return res.status(500).json({ error: reminderError.message });

  const { data, error } = await db.rpc('claim_notifications', { n: 100 });
  if (error) return res.status(500).json({ error: error.message });
  const queue = data || [];
  if (queue.length === 0) return res.status(200).json({ processed: 0, sent: 0, failed: 0 });

  // One bulk profile lookup rather than one database request per notification.
  const recipients = [...new Set(queue.map(n => n.user_id as string))];
  const { data: profiles, error: profileError } = await db.from('profiles')
    .select('id,email').in('id',recipients);
  if (profileError) {
    // Release all claims so transient database errors do not strand notifications.
    await Promise.all(queue.map(n => db.rpc('finish_notification', {
      nid: n.id, delivered: false, failure: 'Recipient lookup failed'
    })));
    return res.status(500).json({ error: profileError.message });
  }
  const emails = new Map((profiles || []).map(p => [p.id as string,p.email as string]));
  let next = 0, sent = 0, failed = 0, markFailed = 0;

  const worker = async () => {
    while (next < queue.length) {
      const notification = queue[next++];
      let delivered = false;
      let failure: string | null = null;
      try {
        const address = emails.get(notification.user_id);
        if (!address) throw new Error('Recipient profile not found');
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + RESEND_API_KEY,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'cswi-notification-' + notification.id
          },
          body: JSON.stringify({
            from: NOTIFICATION_FROM, to: [address],
            subject: notification.subject,
            text: notification.body + '\n\nSign in to Sponty CSWI to review this request.'
          })
        });
        if (!response.ok) throw new Error('Email provider HTTP ' + response.status);
        delivered = true;
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      try {
        const { error: finishError } = await db.rpc('finish_notification', {
          nid: notification.id, delivered, failure
        });
        if (finishError) throw finishError;
        if (delivered) sent++; else failed++;
      } catch {
        // Claim expiry and provider idempotency protect against duplicate sends
        // if the database acknowledgement fails after successful provider delivery.
        markFailed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4,queue.length) }, () => worker()));
  return res.status(markFailed ? 500 : 200).json({
    processed: queue.length, sent, failed, acknowledgementErrors: markFailed,
    remainingMayExist: queue.length === 100
  });
}
