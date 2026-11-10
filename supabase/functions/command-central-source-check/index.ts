import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-xgl-scheduler-token",
};

function decodeEntities(text: string) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: string) {
  let text = decodeEntities(decodeEntities(String(value || "")))
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text;
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

  return {
    added: curr.filter((x) => !prevSet.has(x.toLowerCase())).slice(0, 12),
    removed: prev.filter((x) => !currSet.has(x.toLowerCase())).slice(0, 8),
  };
}

function excerpt(value: string) {
  return value.length > 260 ? value.slice(0, 257) + "…" : value;
}

function hasMaterialLanguage(items: string[]) {
  const text = items.join(" ").toLowerCase();
  return /(deadline|registration|register|date|dates|cancel|closed|closure|permit|recall|rule|final rule|effective|comment period|application|vendor|exhibitor|sponsor|fee|price|schedule|location|venue|access|fire|wildfire|burn|restriction|warning|evacuation|road)/.test(text);
}

function xmlField(block: string, tags: string[]) {
  for (const tag of tags) {
    const openA = "<" + tag + ">";
    const openB = "<" + tag + " ";
    let start = block.indexOf(openA);
    let contentStart = start >= 0 ? start + openA.length : -1;

    if (start < 0) {
      start = block.indexOf(openB);
      if (start >= 0) {
        const gt = block.indexOf(">", start);
        if (gt >= 0) contentStart = gt + 1;
      }
    }

    if (start >= 0 && contentStart >= 0) {
      const close = "</" + tag + ">";
      const end = block.indexOf(close, contentStart);
      if (end >= 0) return cleanText(block.slice(contentStart, end));
    }
  }
  return "";
}

function parseFeedItems(raw: string) {
  const results: any[] = [];
  const rssParts = raw.split("<item").slice(1);

  for (const part of rssParts) {
    const end = part.indexOf("</item>");
    if (end < 0) continue;
    const block = part.slice(0, end);

    const title = xmlField(block, ["title"]);
    const link = xmlField(block, ["link"]);
    const pubDate = xmlField(block, ["pubDate", "dc:date"]);
    const description = xmlField(block, ["content:encoded", "description", "summary"]);

    if (title || link) results.push({ title, link, pubDate, description, evidence: block.slice(0, 12_000) });
  }

  if (results.length) return results;

  const atomParts = raw.split("<entry").slice(1);
  for (const part of atomParts) {
    const end = part.indexOf("</entry>");
    if (end < 0) continue;
    const block = part.slice(0, end);
    const title = xmlField(block, ["title"]);
    const pubDate = xmlField(block, ["updated", "published"]);
    const description = xmlField(block, ["content", "summary"]);

    let link = "";
    const hrefIndex = block.indexOf("href=");
    if (hrefIndex >= 0) {
      const quote = block[hrefIndex + 5];
      const start = hrefIndex + 6;
      const finish = block.indexOf(quote, start);
      if ((quote === '"' || quote === "'") && finish > start) link = block.slice(start, finish);
    }

    if (title || link) results.push({ title, link, pubDate, description, evidence: block.slice(0, 12_000) });
  }
  return results;
}


function looksLikeBoilerplate(text: string) {
  const value = cleanText(text);
  return value.startsWith("Home Info Press Releases") ||
    value.includes("The BLM manages about 245 million acres of public land");
}

function extractArticleBody(normalized: string, title: string) {
  let text = normalized || "";
  const titleIndex = title ? text.lastIndexOf(title) : -1;
  if (titleIndex >= 0) text = text.slice(titleIndex + title.length);

  const rawLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const line of rawLines) {
    if (line.includes("The BLM manages about 245 million acres of public land")) break;
    if (line.includes("Bureau of Land Management Home Page")) break;
    if (line.includes("An official website of the Department of the Interior")) break;
    if (["Home","Info","Press Releases","News","Contact","Media Contact","BLM Office:"].includes(line)) continue;
    if (line.includes("@blm.gov")) continue;
    if (line.length <= 20) continue;
    lines.push(line);
  }

  return lines.join("\n").slice(0, 3500);
}

async function fetchArticleBody(url: string, title: string) {
  if (!url || !url.startsWith("http")) return "";
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ExpeditionGrowthLab-CommandCentral/1.2 (+https://expeditiongrowthlab.com/command-central)",
        "Accept": "text/html,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) return "";
    const raw = await response.text();
    return extractArticleBody(normalizeBody(raw, response.headers.get("content-type")), title);
  } catch {
    return "";
  }
}


function feedEntryRelevant(title: string, body: string) {
  const text = (String(title || "") + " " + String(body || "")).toLowerCase();
  return /(fire|wildfire|burn|closure|closed|road|trail|access|recreation|ohv|off-highway|camp|camping|permit|visitor|safety|public comment|scoping|travel|restriction|weather|flood|snow|smoke|emergency)/.test(text);
}

function dateIsRecent(value: string, days = 21) {
  if (!value) return true;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

function firstSentence(text: string, max = 420) {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  const match = cleaned.match(/^(.{30,}?[.!?])(?:\s|$)/);
  const base = match ? match[1] : cleaned;
  return base.length > max ? base.slice(0, max - 1).trimEnd() + "…" : base;
}

function buildDispatchBrief(source: any, diff: { added: string[]; removed: string[] }) {
  const added = diff.added.map(cleanText).filter(Boolean);
  const sourceName = source.name || "Source";
  let title = sourceName + ": Dispatch update";

  if (sourceName.includes("National Interagency Fire Center")) title = "National Fire Activity Update";
  if (sourceName.includes("EIA Gasoline & Diesel")) title = "U.S. Gasoline and Diesel Fuel Update";
  if (sourceName.includes("NPS Active Alerts")) title = "National Park Service Alert Update";

  const facts = added
    .filter((x) => x.length >= 18 && x.length <= 260)
    .filter((x) => !x.startsWith("http"))
    .slice(0, 5);

  let summary = sourceName + " posted an operational update.";
  if (facts.length) summary += " " + facts.slice(0, 2).join(" ");

  const body = [
    summary,
    facts.length ? "Key details from the official update:\n" + facts.map((f) => "• " + f).join("\n") : "",
    "Use the original source link below for the complete current notice."
  ].filter(Boolean).join("\n\n");

  return { title, summary, body };
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
    .select("id,name,stream,source_type,url,check_cadence,active,watchtower_category,publication_mode")
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
          "User-Agent": "ExpeditionGrowthLab-CommandCentral/1.2 (+https://expeditiongrowthlab.com/command-central)",
          "Accept": "text/html,application/rss+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      const raw = await response.text();
      if (!response.ok) throw new Error("HTTP " + response.status);

      const normalized = normalizeBody(raw, response.headers.get("content-type"));
      const fingerprint = await sha256(normalized);
      const isBaseline = !previousSnapshot;
      const changed = Boolean(previousSnapshot && previousSnapshot.fingerprint !== fingerprint);

      let queueItemId: string | null = null;
      let newEntries = 0;
      let changeBrief: any = null;

      if (source.publication_mode === "government_feed" && source.source_type === "rss") {
        const feedItems = parseFeedItems(raw)
          .filter((item) => dateIsRecent(item.pubDate, 21))
          .slice(0, 20);

        for (const entry of feedItems) {
          const key = entry.link || (entry.title + "|" + entry.pubDate);
          if (!key) continue;

          const entryPreview = cleanText(entry.description);
          if (!feedEntryRelevant(entry.title || "", entryPreview)) continue;

          const keyHash = await sha256(key);
          const slug = "source-entry-" + source.id + "-" + keyHash.slice(0, 16);

          const { data: existing } = await admin
            .from("intelligence_items")
            .select("id,summary,public_body")
            .eq("slug", slug)
            .maybeSingle();

          let cleanBody = cleanText(entry.description).slice(0, 3500);
          if (looksLikeBoilerplate(cleanBody) || cleanBody.length < 80) {
            const articleBody = await fetchArticleBody(entry.link || source.url, entry.title || "");
            if (articleBody) cleanBody = articleBody;
          }
          if (looksLikeBoilerplate(cleanBody)) cleanBody = "";

          const summary = firstSentence(cleanBody, 420) ||
            (source.name + " published a new official notice: " + (entry.title || "Source update") + ".");

          const publicBody = cleanBody ||
            (summary + "\n\nUse the original source link below for the complete current notice.");

          if (existing) {
            if (force && (looksLikeBoilerplate(existing.public_body || existing.summary || "") || !existing.public_body)) {
              await admin
                .from("intelligence_items")
                .update({
                  headline: entry.title || (source.name + ": Official update"),
                  summary,
                  public_body: publicBody,
                  source_url: entry.link || source.url,
                  editorial_evidence: [
                    "OFFICIAL FEED ENTRY",
                    "Source: " + source.name,
                    entry.pubDate ? "Published: " + entry.pubDate : "",
                    entry.link ? "Link: " + entry.link : "",
                    "",
                    publicBody
                  ].filter(Boolean).join("\n"),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
            }
            continue;
          }

          const { data: inserted, error: insertError } = await admin
            .from("intelligence_items")
            .insert({
              slug,
              stream: source.stream,
              watchtower_category: source.watchtower_category,
              public_desk: source.stream,
              headline: entry.title || (source.name + ": Official update"),
              summary,
              source_quality: "primary",
              urgency: hasMaterialLanguage([entry.title, cleanBody]) ? "high" : "medium",
              editorial_status: "verified",
              why_xgl_cares: null,
              public_body: publicBody,
              editorial_evidence: [
                "OFFICIAL FEED ENTRY",
                "Source: " + source.name,
                entry.pubDate ? "Published: " + entry.pubDate : "",
                entry.link ? "Link: " + entry.link : "",
                "",
                cleanBody
              ].filter(Boolean).join("\n"),
              source_url: entry.link || source.url,
              source_id: source.id,
              change_flag: "material",
              source_published_at: entry.pubDate && Number.isFinite(Date.parse(entry.pubDate))
                ? new Date(entry.pubDate).toISOString()
                : null,
              detected_at: new Date().toISOString(),
            })
            .select("id")
            .single();

          if (insertError) throw insertError;
          if (!queueItemId) queueItemId = inserted?.id || null;
          newEntries += 1;
        }
      } else if (
        source.publication_mode === "government_dispatch" &&
        changed &&
        previousSnapshot
      ) {
        const diff = diffText(previousSnapshot.normalized_text || "", normalized);
        const added = diff.added.map(excerpt);
        const removed = diff.removed.map(excerpt);
        const brief = buildDispatchBrief(source, diff);
        const material = hasMaterialLanguage([...added, ...removed]);

        const evidence = [
          "Detected: " + new Date().toISOString(),
          "Source: " + source.name,
          "Stream: " + source.stream,
          "",
          added.length ? "ADDED / CHANGED TEXT:\n- " + added.join("\n- ") : "ADDED / CHANGED TEXT:\n- None isolated.",
          "",
          removed.length ? "REMOVED / REPLACED TEXT:\n- " + removed.join("\n- ") : "REMOVED / REPLACED TEXT:\n- None isolated."
        ].join("\n");

        const slug = "source-dispatch-" + source.id + "-" + fingerprint.slice(0, 12);
        const { data: item, error: itemError } = await admin
          .from("intelligence_items")
          .upsert({
            slug,
            stream: source.stream,
            watchtower_category: source.watchtower_category,
            public_desk: source.stream,
            headline: brief.title,
            summary: brief.summary,
            source_quality: "primary",
            urgency: material ? "high" : "medium",
            editorial_status: "verified",
            why_xgl_cares: null,
            public_body: brief.body,
            editorial_evidence: evidence,
            source_url: source.url,
            source_id: source.id,
            change_flag: material ? "material" : "minor",
          }, { onConflict: "slug" })
          .select("id")
          .single();

        if (itemError) throw itemError;
        queueItemId = item?.id || null;
        changeBrief = { added, removed, material };
      } else if (
        source.publication_mode === "monitor_only" &&
        changed &&
        previousSnapshot
      ) {
        const diff = diffText(previousSnapshot.normalized_text || "", normalized);
        const material = hasMaterialLanguage([...diff.added, ...diff.removed]);

        if (material) {
          const added = diff.added.map(excerpt);
          const removed = diff.removed.map(excerpt);
          const evidence = [
            "Detected: " + new Date().toISOString(),
            "Source: " + source.name,
            "Stream: " + source.stream,
            "",
            added.length ? "ADDED / CHANGED TEXT:\n- " + added.join("\n- ") : "ADDED / CHANGED TEXT:\n- None isolated.",
            "",
            removed.length ? "REMOVED / REPLACED TEXT:\n- " + removed.join("\n- ") : "REMOVED / REPLACED TEXT:\n- None isolated."
          ].join("\n");

          const slug = "source-monitor-" + source.id + "-" + fingerprint.slice(0, 12);
          const { data: item, error: itemError } = await admin
            .from("intelligence_items")
            .upsert({
              slug,
              stream: source.stream,
              watchtower_category: source.watchtower_category,
              public_desk: source.stream,
              headline: source.name + ": Monitored source change",
              summary: "Command Central detected a potentially material change at " + source.name + ". This item stays private until a clean source-level brief is available.",
              source_quality: ["official_website", "api"].includes(source.source_type) ? "primary" : "strong_secondary",
              urgency: "medium",
              editorial_status: "hold",
              why_xgl_cares: null,
              public_body: null,
              editorial_evidence: evidence,
              source_url: source.url,
              source_id: source.id,
              change_flag: "material",
            }, { onConflict: "slug" })
            .select("id")
            .single();

          if (itemError) throw itemError;
          queueItemId = item?.id || null;
          changeBrief = { added, removed, material };
        }
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
          publication_mode: source.publication_mode,
          new_entries: newEntries,
          change_brief: changeBrief,
        },
        created_queue_item_id: queueItemId,
      });

      results.push({
        source: source.name,
        status: changed ? "changed" : isBaseline ? "baseline" : "ok",
        publication_mode: source.publication_mode,
        new_entries: newEntries,
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
    new_entries: results.reduce((sum, r) => sum + Number(r.new_entries || 0), 0),
    results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});