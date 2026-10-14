# Sponty CSWI — Outlook Community Service Requests

Outlook add-in for community service requests, approvals, document exchange, equipment and school bus coordination.

**Stack:** React 19, TypeScript, Vite, Office.js, Supabase Auth (Microsoft Entra ID), PostgreSQL with RLS, private Supabase Storage, Vercel, and optional Resend notifications.

## Features
- **Requestor:** Drafts, activity requests, equipment and school bus questions, attachments, comments, revisions, cancellations, completion evidence before closure.
- **Approver:** Assigned review inbox, approve/reject/request changes with reasons, internal notes and document requests.
- **Admin:** User role assignment, approver assignment, operational progress, resource coordination and activity history.
- **Outlook:** Create request from open email, detect CSR reference, link email to request, import email attachments, draft replies and calendar appointments, pin task pane.
- **Reminders:** Secure server-side notification queue and daily scheduled email delivery (optional Resend configuration).

## Setup
See [Deployment guide](docs/DEPLOYMENT.md) and [Security review](docs/SECURITY.md).

Install Node 22, run npm install, copy .env.example to .env.local, and use npm run dev for local browser UI preview. Outlook testing requires a deployed HTTPS URL, Microsoft 365 mailboxes and Supabase configuration.

**Status:** Test-tenant implementation. Build, manifest validation, negative access-control tests and Outlook end-to-end tests are required before production use.
