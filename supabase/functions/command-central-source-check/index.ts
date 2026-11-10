import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-xgl-scheduler-token",
};

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeBody(input: string, contentType: string | null) {
  let text = input;
  if ((contentType || "").includes("text/html")) {
    text = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|div|section|article|tr|td|th|header|footer|main|aside|nav)>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
    text = decodeEntities(text);
  }

  return text
    .replace(/\b\d{10,13}\b/g, "<timestamp>")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 350_000);
}

function segments(text: string) {
  const pieces = text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 24 && s.length <= 420);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const key = piece.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(piece);
    }
  }
  return out;
}

function diffText(previous: string, current: string) {
  const prev = segments(previous);
  const curr = segments(current);
  const prevSet = new Set(prev.map((x) => x.toLowerCase()));
  const currSet = new Set(curr.map((x) => x.toLowerCase()));

  const added = curr.filter((x) => !prevSet.has(x.toLowerCase())).slice(0, 8);
  const removed = prev.filter((x) => !currSet.has(x.toLowerCase())).slice(0, 6);

  return { added, removed };
}

function excerpt(value: string) {
  return value.length > 240 ? value.slice(0, 237) + "…" : value;
}

function stripTags(value: string) {
  let out = "";
  let inTag = false;
  for (const ch of decodeEntities(value || "")) {
    if (ch === "<") { inTag = true; out += " "; continue; }
    if (ch === ">") { inTag = false; out += " "; continue; }
    if (!inTag) out += ch;
  }
  return out.split(/\\s+/).filter(Boolean).join(" ").trim();
}

function xmlValue(raw: string, tag: string) {
  const open = "<" + tag + ">";
  const close = "</" + tag + ">";
  const start = raw.indexOf(open);
  if (start < 0) return "";
  const end = raw.indexOf(close, start + open.length);
  if (end < 0) return "";
  return stripTags(raw.slice(start + open.length, end));
}

function buildSourceBrief(source: any, diff: { added: string[]; removed: string[] }) {
  const added = diff.added || [];
  let title = "";
  let articleUrl = source.url;

  for (const raw of added) {
    if (!title) title = xmlValue(raw, "title") || title;
    const link = xmlValue(raw, "link");
    if (link && link.startsWith("http")) articleUrl = link;
  }

  const sourceName = source.name || "Source";
  if (!title) {
    if (sourceName.includes("National Interagency Fire Center")) title = "National Fire Activity Update";
    else if (sourceName.includes("EIA Gasoline & Diesel")) title = "U.S. Gasoline and Diesel Fuel Update";
    else {
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      const candidate = added
        .map(stripTags)
        .find((x) =>
          x.length >= 18 &&
          x.length <= 160 &&
          !x.startsWith("No clean added-text") &&
          !x.startsWith("http") &&
          !months.some((month) => x.startsWith(month))
        );
      title = candidate || (sourceName + ": Source update");
    }
  }

  const facts = added
    .map(stripTags)
    .filter(Boolean)
    .filter((x) => x !== title)
    .filter((x) => !x.startsWith("No clean added-text"))
    .filter((x) => !x.startsWith("http"))
    .filter((x) => !x.startsWith("pubDate"))
    .filter((x) => !x.startsWith("guid"))
    .filter((x) => !x.startsWith("dc:creator"))
    .filter((x) => !x.includes("min read"))
    .filter((x) => x.length >= 18 && x.length <= 220)
    .slice(0, 3);

  const detected = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
  }).format(new Date());

  let summary = sourceName + " posted an update concerning " + title + ". Command Central detected the change on " + detected + ".";
  if (title === "National Fire Activity Update" && facts.length) {
    summary = sourceName + " posted a national fire-activity update. " + facts.slice(0, 2).join(" ");
  } else if (title === "U.S. Gasoline and Diesel Fuel Update" && facts.length) {
    summary = "The U.S. Energy Information Administration posted its latest gasoline and diesel fuel update. " + facts.slice(0, 2).join(" ");
  }

  const bodyParts = [summary];
  if (facts.length) {
    bodyParts.push("Key details reported by the source:\n" + facts.map((f) => "• " + f).join("\n"));
  }
  bodyParts.push("For the complete notice, context, and any operational details, use the source link below.");

  return {
    title,
    summary,
    body: bodyParts.join("\n\n"),
    articleUrl
  };
}


function hasMaterialLanguage(items: string[]) {
  const text = items.join(" ").toLowerCase();
  return /(deadline|registration|register|date|dates|cancel|closed|closure|permit|recall|rule|final rule|effective|comment period|application|vendor|exhibitor|sponsor|fee|price|schedule|location|venue|access)/.test(text);
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authorized = false;
  let authMode = "none";

  const schedulerToken = req.headers.get("x-xgl-scheduler-token");
  if (schedulerToken) {
    const tokenHash = await sha256(schedulerToken);
    const { data: scheduler } = await admin
      .from("scheduler_tokens")
      .select("name")
      .eq("name", "command-central-source-watch")
      .eq("token_hash", tokenHash)
      .eq("active", true)
      .maybeSingle();

    if (scheduler) {
      authorized = true;
      authMode = "scheduler";
    }
  }

  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { data: role } = await userClient.rpc("current_xgl_role");
        if (["owner", "admin", "editor"].includes(role)) {
          authorized = true;
          authMode = "staff";
        }
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Not authorized" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body?.limit || 100), 100));
  const sourceId = body?.source_id || null;
  const force = Boolean(body?.force || sourceId);

  let query = admin
    .from("sources")
    .select("id,name,stream,source_type,url,check_cadence,active")
    .eq("active", true)
    .not("url", "is", null)
    .order("name")
    .limit(limit);

  if (sourceId) query = query.eq("id", sourceId);

  const { data: sources, error: sourcesError } = await query;
  if (sourcesError) {
    return new Response(JSON.stringify({ error: sourcesError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const source of sources || []) {
    try {
      const { data: previousSnapshot } = await admin
        .from("source_snapshots")
        .select("fingerprint,normalized_text,checked_at")
        .eq("source_id", source.id)
        .maybeSingle();

      if (!force && previousSnapshot?.checked_at) {
        const ageMs = Date.now() - new Date(previousSnapshot.checked_at).getTime();
        const dueAfterMs =
          source.check_cadence === "monthly" ? 30 * 24 * 60 * 60 * 1000 :
          source.check_cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 :
          0;

        if (dueAfterMs > 0 && ageMs < dueAfterMs) {
          results.push({
            source: source.name,
            status: "skipped",
            cadence: source.check_cadence,
            next_due_in_hours: Math.ceil((dueAfterMs - ageMs) / (60 * 60 * 1000)),
          });
          continue;
        }
      }

      const response = await fetch(source.url, {
        headers: {
          "User-Agent": "ExpeditionGrowthLab-CommandCentral/1.1 (+https://expeditiongrowthlab.com/command-central)",
          "Accept": "text/html,application/rss+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const normalized = normalizeBody(raw, response.headers.get("content-type"));
      const fingerprint = await sha256(normalized);

      const isBaseline = !previousSnapshot;
      const changed = Boolean(previousSnapshot && previousSnapshot.fingerprint !== fingerprint);
      let queueItemId = null;
      let changeBrief: any = null;

      if (changed && previousSnapshot) {
        const diff = diffText(previousSnapshot.normalized_text || "", normalized);
        const material = hasMaterialLanguage([...diff.added, ...diff.removed]);
        const added = diff.added.map(excerpt);
        const removed = diff.removed.map(excerpt);

        const addedText = added.length
          ? "ADDED / CHANGED TEXT:\n- " + added.join("\n- ")
          : "ADDED / CHANGED TEXT:\n- No clean added-text snippet could be isolated.";
        const removedText = removed.length
          ? "REMOVED / REPLACED TEXT:\n- " + removed.join("\n- ")
          : "REMOVED / REPLACED TEXT:\n- No clean removed-text snippet could be isolated.";

        const reviewInstruction =
          "EDITOR REVIEW:\n1. Compare the snippets below with the live source.\n2. Decide whether this affects an event date, deadline, registration, access, regulation, safety issue, vendor opportunity, or other XGL-relevant fact.\n3. If material, verify the fact at the primary source and rewrite it for public use. If it is cosmetic/dynamic noise, Kill the item.";

        const publicBody = [
          `Detected: ${new Date().toISOString()}`,
          `Source: ${source.name}`,
          `Stream: ${source.stream}`,
          "",
          addedText,
          "",
          removedText,
          "",
          reviewInstruction,
        ].join("\n");

        const brief = buildSourceBrief(source, diff);
        const summary = brief.summary;

        const slug = `source-change-${source.id}-${fingerprint.slice(0, 12)}`;
        const { data: item, error: itemError } = await admin
          .from("intelligence_items")
          .upsert({
            slug,
            stream: source.stream,
            headline: brief.title,
            summary,
            source_quality: ["official_website", "api", "rss"].includes(source.source_type)
              ? "primary"
              : "strong_secondary",
            urgency: material ? "high" : "medium",
            editorial_status: "needs_verification",
            why_xgl_cares: `This monitored source feeds ${source.stream}. The watcher detected a real text-level difference from the previous stored snapshot; the editor’s job is to decide whether the difference is materially relevant to XGL users.`,
            public_body: brief.body,
            editorial_evidence: publicBody,
            source_url: brief.articleUrl || source.url,
            source_id: source.id,
            change_flag: material ? "material" : "minor",
          }, { onConflict: "slug" })
          .select("id")
          .single();

        if (itemError) throw itemError;
        queueItemId = item?.id || null;
        changeBrief = { added, removed, material };
      }

      await admin.from("source_snapshots").upsert({
        source_id: source.id,
        fingerprint,
        normalized_text: normalized,
        checked_at: new Date().toISOString(),
      });

      await admin.from("source_checks").insert({
        source_id: source.id,
        status: changed ? "changed" : "ok",
        fingerprint,
        details: {
          auth_mode: authMode,
          http_status: response.status,
          content_type: response.headers.get("content-type"),
          bytes: raw.length,
          first_snapshot: isBaseline,
          previous_fingerprint: previousSnapshot?.fingerprint || null,
          change_brief: changeBrief,
        },
        created_queue_item_id: queueItemId,
      });

      results.push({
        source: source.name,
        status: changed ? "changed" : isBaseline ? "baseline" : "ok",
        queue_item_id: queueItemId,
        change_brief: changeBrief,
      });
    } catch (error) {
      await admin.from("source_checks").insert({
        source_id: source.id,
        status: "error",
        details: { auth_mode: authMode, error: String(error?.message || error) },
      });
      results.push({ source: source.name, status: "error", error: String(error?.message || error) });
    }
  }

  return new Response(JSON.stringify({
    checked: results.length,
    changed: results.filter((r) => r.status === "changed").length,
    errors: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});