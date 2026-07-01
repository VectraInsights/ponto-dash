import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/extract-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const file = form.get("file") as Blob | null;
          const selectedYear = Number(form.get("selectedYear") ?? 0);
          const selectedMonth = Number(form.get("selectedMonth") ?? 0);

          if (!file) {
            return new Response(JSON.stringify({ error: "No file provided" }), {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          const arrayBuffer = await file.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const mimeType = (file as any).type || "image/png";

          const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "Server is missing GEMINI_API_KEY" }), {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

          const payload = {
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: base64,
                    },
                  },
                  {
                    text: "Extraia todo o texto legível do cartão de ponto nesta imagem. Retorne apenas o texto extraído, preservando datas e horários (formato DD/MM/AAAA ou DD/MM/AA) e horários (HH:MM).",
                  },
                ],
              },
            ],
          };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify(payload),
          });

          const json = await res.json().catch(() => null);
          if (!res.ok) {
            const msg = json?.error?.message ?? "Gemini API error";
            return new Response(JSON.stringify({ error: String(msg) }), { status: 502, headers: { "content-type": "application/json; charset=utf-8" } });
          }

          const candidates = json?.candidates ?? [];
          const text = (candidates[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("\n").trim();

          return new Response(JSON.stringify({ text, selectedYear, selectedMonth }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        } catch (err: any) {
          console.error("/api/extract-image error:", err);
          return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers: { "content-type": "application/json; charset=utf-8" } });
        }
      },
    },
  },
});
