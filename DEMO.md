# Vendor Control Tower - demo guide

PO → vendor lead time → QC → lot + container → India port → warehouse GRN → payment. Sample data, SAP simulated, AI on the live Claude API.

## Run it

```bash
node node_modules/next/dist/bin/next dev
```

Open http://localhost:3000 and pick a persona. No passwords in the demo.

- **Reset before every demo** - "Reset demo data" at the bottom of the persona screen. Dates are re-based to today.
- First-time setup on your own laptop (no accounts needed):
  1. `npm install`
  2. Create a file `.env.local` containing one line: `DATABASE_URL=postgres://postgres:postgres@localhost:54329/vms`
  3. In one terminal, run `npm run db:local` and leave it open (this is the small local database).
  4. In a second terminal, run `npm run db:setup` (creates the tables and loads sample data), then the `next dev` command above.
  - The AI buttons (daily brief, assistant, invoice reading) need `ANTHROPIC_API_KEY=...` in `.env.local`. Everything else works without it.
- Checks: `npm test` (28 rule tests) and `npm run typecheck`.

## 10-minute demo script

1. **CEO (Gaurav)** - Dashboard. Open value, value at risk, on-time %. Click *Generate today's brief*.
2. **Ask** (bottom right) - "Which vendor is hurting us most, and what does it cost ?"
3. **Procurement (GD)** - Control tower → *At risk*. Open a Harmony PO → *Explain and suggest actions*.
4. **Vendor (Liu Yang, PearlTone)** - *Needs me* → accept a PO with a lead time → update production → request QC.
5. **Procurement** - schedule the inspection.
6. **QC (Rohan)** - on a phone: open the inspection, fail one critical check with a note, sign off. Vendor sees exactly what to fix.
7. **Vendor** - on a QC-passed PO: create lot ID → add container. Type a wrong container number first - the check-digit rule catches it.
8. **Documents** - on a shipped PO, download the *over-billed invoice* sample and upload it. Claude reads it, the mismatch is flagged, payment goes on hold.
9. **Logistics (Vikram)** - Shipments board. The container stuck at Nhava Sheva is the red card.
10. **Warehouse (Suresh)** - post GRN → PO closes in SAP → balance payment appears with its due date.
11. **Finance (Rupali)** - Payments: 3-way match column, release or hold.
12. **Procurement** - QC checklists → describe a new product → *Draft checklist with AI* → approve.

## Stories planted in the data

- **Dongguan Harmony** - chronically late, three open POs behind plan.
- **Huizhou BrightSound** - fails QC often (battery, BIS label); one PO in rework.
- **Container stuck at Nhava Sheva** for 3 weeks - demurrage risk.
- **Split shipment** - one PO in two lots, one received, one at sea.
- **Over-billed invoice** - closed PO with payment on hold.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| Workflow rules, roles, audit trail | SAP (mock adapter in `src/lib/sap/`) |
| Risk scoring, alerts, vendor scorecards | Logins (persona picker) |
| Claude: assistant, document reading, checklist drafting, briefs | Carrier ETA feed (logistics updates by hand) |

## Where things live

- `src/lib/workflow.ts` - every state change, with role and stage checks
- `src/lib/rules.ts` + `rules.test.ts` - pure rules: transitions, QC verdict, container check digit, document matching
- `src/lib/risk.ts` - delay risk score and vendor scorecard maths
- `src/lib/ai.ts`, `src/lib/assistant-tools.ts`, `src/app/api/assistant/` - Claude integration
- `src/db/seed.ts` - demo data generator
