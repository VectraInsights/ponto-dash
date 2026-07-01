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

          const promptText = `Você é um assistente que extrai linhas de cartões de ponto. Recebe uma imagem (anexada) e deve retornar um JSON estrito com a chave "rows", cujo valor é um array de strings. Cada string representa uma linha extraída que contém data e horários no formato aproximado encontrado (por exemplo "01/03 08:00 12:00 13:00 17:00" ou "01/03/2026 08:00 12:00"). Retorne SOMENTE JSON válido, sem explicações.

Exemplo:
{"rows": ["01/03 08:00 12:00 13:00 17:00", "02/03 08:05 12:05 13:00 17:10"]}

Se nada for encontrado, retorne {"rows": []}.
`;

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
                    text: promptText,
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
          const raw = (candidates[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("\n").trim();

          // Try to find and parse JSON in the model output
          let parsedRows: string[] | null = null;
          try {
            // If raw is exactly JSON
            parsedRows = JSON.parse(raw)?.rows ?? null;
          } catch (e) {
            // Try to extract JSON substring
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) {
              try {
                parsedRows = JSON.parse(m[0])?.rows ?? null;
              } catch (e2) {
                parsedRows = null;
              }
            }
          }

          if (!Array.isArray(parsedRows)) {
            // fallback: return raw text so client can try parsing
            return new Response(JSON.stringify({ text: raw, selectedYear, selectedMonth }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" },
            });
          }

          return new Response(JSON.stringify({ rows: parsedRows, selectedYear, selectedMonth }), {
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
