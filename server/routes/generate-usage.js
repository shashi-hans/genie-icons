// GET /api/generate-usage  how much the generator is used (admin only)
//
// Answers two questions without Google Analytics or any third party: how many
// people have generated an icon, and which names they generate.
//
// Admin-only, and aggregates only. The underlying table is history, which keys
// on the guest cookie and is personal data under the DPDP Act 2023, so the
// counting happens in the database and only numbers come back — see
// supabase/migrations/0006_generate_usage.sql. Nothing here can say who
// generated anything, which is why it needs no retention window of its own.
//
// Read-only: the generator already writes its history entry through
// POST /api/history, so there is nothing to record here.
import { handler, json, methodIs, requireAdmin } from "../lib/http.js";
import { getStore } from "../lib/store.js";

const DEFAULT_LIMIT = 20;

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  if (!requireAdmin(req, res)) return;

  const usage = await getStore().listGenerateUsage(Number(req.query?.limit) || DEFAULT_LIMIT);
  return json(res, 200, usage);
});
