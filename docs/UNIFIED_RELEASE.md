# Sponty CSWI — unified release plan (test tenant first)

**Status:** Release candidate, not deployed to Supabase or Vercel. The same existing Outlook manifest is retained.

## Scope implemented in this release branch

1. **Resources:** Resource inventory, multi-selection in request form, live availability checks, required bus capacity validation, safe `tstzrange` exclusion constraints and booking holds on final approval. A competing approval fails atomically; cancelled requests release holds.
2. **Routing:** Priority-ranked approval rules by department, bus requirement and participant threshold; optional second approver; configurable delegation windows and service-role daily escalation.
3. **Change tracking:** The `fields_changed` audit event contains JSON-formatted before/after values for every changed form field.
4. **Per-type checklists:** Bus-trip waivers, transport plan and one chaperone per 20 participants; off-site risk assessment confirmation. The database enforces required checks on submission.
5. **Email input:** Deterministic proposals for explicit headcount, venue and ISO-style start/end dates. Nothing is applied until the requestor clicks **Apply suggested fields**. Users must review all proposals before submitting.
6. **Notification action:** Approve/reject within the signed-in **in-app** Notifications panel; the database enforces assignment, independent review and state transitions.
7. **Analytics:** Admin dashboard built from accessible requests and recent request-event history, including approval cycle time and stalled requests.
8. **Core:** Includes the previously merged core hardening (evidence, anti-self-approval, admin updates, safe CSV and notifications).

### Not automatically available

**Approve/Reject inside an actual Outlook email** requires registering an Actionable Messages provider and verifying Microsoft Entra bearer tokens on the server. Do not expose a public action endpoint or treat an emailed link as an approval. See:
- https://learn.microsoft.com/en-us/outlook/actionable-messages/get-started
- https://learn.microsoft.com/en-us/outlook/actionable-messages/security-requirements

This release provides authenticated **in-app** actions instead. Microsoft provider registration is a separate integration prerequisite.

## Database release

1. Back up the test Supabase database. Confirm migrations `202610140001_init.sql` through `202610140004_core_hardening.sql` have already been applied, in order.
2. On the **test project**, apply:
   - `supabase/migrations/202610150005_resources.sql`
   - `supabase/migrations/202610150006_workflow.sql`
3. Run tests using the Supabase CLI and Docker (`supabase start` then `supabase test db`). At minimum verify `supabase/tests/core_hardening.sql` and `supabase/tests/unified_release.sql`.
4. Create a sample **bus** (capacity sufficient for passengers) and sample equipment using **Admin → Operations**.
5. Create one or two approval rules. Keep one valid administrator/approver available for fallback.
6. In the test app, submit two requests for the same resource and overlapping times: only one final approval may reserve it. Check alternatives in the resource picker.
7. Verify two-stage approvals, self-approval rejection, delegation, escalation (requires the service cron), checklists, diff logs, notifications and that unauthorized users cannot access bookings or other users' requests.
8. Apply the SQL in Production **only after successful testing and backup**, immediately before merging/deploying the matching application release.

## Vercel & Outlook release

1. Review and merge **one unified release PR** after database verification.
2. Confirm Vercel Production deploys the commit from that merge, and that `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and optional server-only notification configuration are correct.
3. Test as Requestor, Approver and Admin in Outlook Classic, new Outlook and Outlook on the web.
4. Reopen the Outlook task pane. **Do not re-upload the Outlook manifest:** this branch changes web and database behavior, not Outlook command definitions, task pane URL or permissions.

## Rollback limits

Reverting the Vercel deployment alone does not revert PostgreSQL schema migrations. The migrations add tables/columns and replace RPC behavior; take a SQL/database backup and prepare a tested rollback plan before production changes. Do not drop tables or data to recover a broken release without confirming preservation requirements.

## Scalability notes

- Resource exclusion blocks overlapping holds regardless of concurrent approvals.
- Cron keeps the pre-existing daily schedule and processes up to 100 notifications per invocation; a backlog can span multiple days. More frequent schedules require Vercel plan verification.
- Analytics reads a recent subset of data, not an unlimited full-history report.
- Deployment is gated on local SQL tests and tenant E2E tests, **not** just the TypeScript CI build.
