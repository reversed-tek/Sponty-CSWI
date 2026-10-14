# Sponty CSWI — Outlook Community Service Requests

Outlook add-in for community service requests, approvals, document exchange, equipment and school bus coordination.

**Stack:** React 19, TypeScript, Vite, Office.js, Supabase Auth (Microsoft Entra ID), PostgreSQL with RLS, private Supabase Storage, Vercel, and optional Resend notifications.

## Features
- **Requestor:** Drafts, activity requests, equipment and school bus questions, attachments, comments, revisions, cancellations, completion evidence before closure.
- **Approver:** Assigned review inbox, approve/reject/request changes with reasons, internal notes and document requests.
- **Admin:** User role assignment, approver assignment, operational progress, resource coordination and activity history.
- **Outlook:** Create request from open email, detect CSR reference, link email to request, import email attachments, draft replies and calendar appointments, pin task pane.
- **Reminders:** Secure server-side notification queue and daily scheduled email delivery (optional Resend configuration).

## PR #2: Outlook compose and request updates

The same Outlook add-in now appears on both **message read** and **message compose** ribbons. In a draft, users can search authorized requests, insert a CSR reference into the subject, and insert a plain-text request summary at the cursor. No emails are sent automatically.

In-app notification inbox, read receipts, new-comment notifications, request search/status filters and admin CSV export are included. A linked message can be recognized by its stored Outlook message ID even if its subject does not contain a CSR reference.

**Upgrade note:** Apply `supabase/migrations/202610140003_notifications.sql` before deploying PR #2. Generate a new manifest and **replace/redeploy** the old Outlook add-in registration. Version 1.1.0.0 requests `ReadWriteItem` (to edit the **current draft only**) rather than `ReadItem`; this is not blanket mailbox or Graph access. Some tenant deployments may prompt administrators to approve the new permission.

## Setup
See [Deployment guide](docs/DEPLOYMENT.md) and [Security review](docs/SECURITY.md).

Install Node 22, run npm install, copy .env.example to .env.local, and use npm run dev for local browser UI preview. Outlook testing requires a deployed HTTPS URL, Microsoft 365 mailboxes and Supabase configuration.

**Status:** Test-tenant implementation. Build, manifest validation, negative access-control tests and Outlook end-to-end tests are required before production use.
