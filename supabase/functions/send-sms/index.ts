import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ARKESEL_API_KEY = Deno.env.get("ARKESEL_API_KEY");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const { to, message } = await req.json();

    const response = await fetch("https://sms.arkesel.com/sms/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": ARKESEL_API_KEY!,
      },
      body: JSON.stringify({
        action: "send-sms",
        to: to,
        from: "Arkesel", // Default whitelisted Sender ID
        sms: message,
      }),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});