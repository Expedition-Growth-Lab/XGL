import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://expeditiongrowthlab.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function passwordError(password: string) {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Password is too long.";
  if (!/[a-z]/.test(password)) return "Include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Include an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Include a symbol.";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token, password } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    return new Response(JSON.stringify({ error: "This setup link is invalid or expired." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (typeof password !== "string") {
    return new Response(JSON.stringify({ error: "Enter a password." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const problem = passwordError(password);
  if (problem) {
    return new Response(JSON.stringify({ error: problem }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const { data: claim, error: claimError } = await admin
    .from("command_central_password_setup_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();

  if (claimError || !claim?.user_id) {
    return new Response(JSON.stringify({ error: "This setup link is invalid, expired, or has already been used." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(claim.user_id);
  const email = userResult?.user?.email?.toLowerCase();

  if (userError || !email) {
    return new Response(JSON.stringify({ error: "Password setup could not be completed." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: staff } = await admin
    .from("xgl_staff")
    .select("email,role,active")
    .eq("active", true)
    .ilike("email", email)
    .maybeSingle();

  if (!staff) {
    return new Response(JSON.stringify({ error: "Password setup is not authorized for this account." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(claim.user_id, { password });

  if (updateError) {
    return new Response(JSON.stringify({ error: "Password setup failed. A new setup link will be required." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await admin
    .from("command_central_password_setup_tokens")
    .delete()
    .eq("user_id", claim.user_id)
    .is("used_at", null);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});