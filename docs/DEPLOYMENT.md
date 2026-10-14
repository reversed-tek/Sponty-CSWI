# Sponty CSWI — test tenant deployment

The target is an Outlook add-in used with **Microsoft 365 Exchange Online mailboxes** in your Entra developer tenant. A directory without licensed/usable Exchange Online mailboxes is insufficient to test the Outlook integration.

## 1. Entra application
1. Go to Entra admin center → App registrations → New registration..
2. Name it Sponty CSWI; choose **Accounts in this organizational directory only**.
3. Add a **Web** redirect URI: https://YOUR_PROJECT.supabase.co/auth/v1/callback
4. Save the client ID and tenant ID, and create a client secret (store it only in Supabase).
5. No broad Microsoft Graph mail/calendar scopes are needed for the user-triggered Office.js actions.

## 2. Supabase database and identity
1. Create a project. Authentication → Providers → Azure: enter the Entra client ID and client secret.
2. Set Azure Tenant URL to https://login.microsoftonline.com/YOUR_TENANT_ID.
3. Authentication → URL Configuration: Site URL = https://YOUR_APP.vercel.app ; add https://YOUR_APP.vercel.app/auth/callback to redirect allowlist.
4. Run these SQL migrations IN ORDER in the Supabase SQL Editor:
   - supabase/migrations/202610140001_init.sql
   - supabase/migrations/202610140002_reminders.sql
5. Verify the private cswi-documents bucket, table RLS and the RPC functions.
6. Record your project URL and **publishable/anon** key. The service-role key must never reach browser code.

## 3. Vercel setup
1. Import github.com/reversed-tek/Sponty-CSWI into Vercel as a Vite application.
2. Build: npm run build ; Output directory: dist.
3. Configure client variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
4. Deploy to a stable HTTPS domain. Make sure Supabase's redirect allowlist matches that domain exactly.
5. Optional daily notification email: set **server-only** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFICATION_FROM (verified sending domain), CRON_SECRET (long secret). Do **not** prefix these with VITE_. Redeploy.
6. Vercel Cron runs at 00:00 UTC (08:00 Asia/Manila) and calls /api/cron/notifications; requires Authorization: Bearer CRON_SECRET. If email settings are missing, the endpoint intentionally returns 503.
7. Check hosted /icons/icon-16.png, /icons/icon-32.png, /icons/icon-64.png, /icons/icon-80.png. PNG images are generated at build time.

## 4. Role bootstrap
Sign in as your three test users first so that Supabase creates a profile for each.

Then in Supabase SQL Editor execute, after replacing the placeholder addresses:

    insert into public.user_roles(user_id,role)
    select id,'admin' from public.profiles where lower(email)=lower('admin@yourtenant.onmicrosoft.com')
    on conflict do nothing;

    insert into public.user_roles(user_id,role)
    select id,'approver' from public.profiles where lower(email)=lower('approver@yourtenant.onmicrosoft.com')
    on conflict do nothing;

Users get Requestor by default. Admin can add roles and assign an Approver to a pending request. The database enforces the role permissions.

## 5. Create and sideload the Outlook add-in
After Vercel deployment, on your development computer:

    npm install
    npm run manifest -- https://YOUR_APP.vercel.app

This creates **dist-manifest/manifest.xml**. Do not upload the placeholder template.

Validate it using Microsoft's tooling where available:

    npx office-addin-manifest validate dist-manifest/manifest.xml

In Microsoft 365 Admin Center → Settings → Integrated apps → Upload custom apps, upload the generated XML and assign it to the three test accounts. No public Marketplace approval is required for a private add-in. In Outlook on the web or new Outlook for Windows, open any email, launch Sponty CSWI through Apps/Add-ins, and pin the panel where supported.

The initial command is a **Message Read** add-in and generally requires a selected message.

## 6. Acceptance test plan
1. Requestor creates a draft from an email, edits it, submits it and sees only their own requests.
2. Admin assigns an Approver and coordinates equipment and school bus.
3. Approver sees the assigned pending request, returns changes with a reason, then approves a resubmission.
4. Requestor responds to a document request and uploads PDF; Approver can open authorized files. Internal notes are hidden from Requestor.
5. Open a message mentioning CSR-YYYY-000001: add-in recognizes the reference. Test link email, import attachment and draft a reply.
6. Admin marks Approved → Scheduled → In Progress → Completed. Test calendar event **draft** after approval.
7. Verify a Requestor cannot directly update approval status, alter roles or fetch other users' private files.
8. Test optional Resend email delivery and reminders via Vercel Cron and logs.
9. Repeat supported scenarios in Outlook web and new Outlook on Windows.

## 7. Troubleshooting
- **Login dialog does not work:** Entra callback points to Supabase; check Vercel /auth/callback is allowlisted and Office Dialog opens on the same origin as the task pane.
- **No approvers:** Ensure users sign in at least once, grant Approver role and assign a reviewer to the request.
- **Uploads fail:** Only PDF, PNG, JPG, TXT, DOCX, XLSX ≤10 MB; request must not be closed.
- **Icons missing:** Confirm generated PNG URLs return HTTP 200 on Vercel and manifest URLs contain your actual domain.
- **Cron 401 or 503:** Check CRON_SECRET or the optional server-only Resend settings.
- **Permission error:** Confirm RLS migration, current user, role and ownership.

Do not deploy with real student data until security, privacy, retention, malware handling and school policy reviews have been completed.
