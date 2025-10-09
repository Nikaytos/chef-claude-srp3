import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { InferenceClient } from "@huggingface/inference";

const app = express();
const PORT = process.env.PORT || 8787;

app.use(express.json());

const allowedOrigin =
  process.env.NODE_ENV !== "production"
    ? "http://localhost:5173"
    : process.env.CORS_ORIGIN || "*";

app.use(cors({ origin: allowedOrigin }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const hf = new InferenceClient(process.env.HF_ACCESS_TOKEN);

function requireCodeword(req, res, next) {
  const provided = String(req.body?.codeword ?? "").trim();
  const expected = String(process.env.ACCESS_CODE ?? "").trim();
  if (!expected) {
    console.warn("ACCESS_CODE is not set; skipping check.");
    return next();
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ ok: false, error: "Invalid codeword" });
  }
  next();
}

const toList = (body) => {
  const arr = Array.isArray(body?.ingredients) ? body.ingredients : [];
  return arr.map(String).join(", ");
};

const SYSTEM_PROMPT = `
You are an assistant that receives a list of ingredients that a user has and suggests a recipe they could make with some or all of those ingredients. You don't need to use every ingredient they mention in your recipe. The recipe can include additional ingredients they didn't mention, but try not to include too many extra ingredients. Format your response in markdown to make it easier to render to a web page
`.trim();

app.post("/api/auth/verify", (req, res) => {
  const provided = String(req.body?.codeword ?? "").trim();
  const expected = String(process.env.ACCESS_CODE ?? "").trim();
  if (expected && provided === expected) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

app.post("/api/claude", requireCodeword, async (req, res) => {
  try {
    const ingredientsString = toList(req.body);
    const msg = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `I have ${ingredientsString}. Please give me a recipe you'd recommend I make!`,
        },
      ],
    });

    const text =
      msg?.content?.find?.((c) => c.type === "text")?.text ??
      msg?.content?.[0]?.text ??
      "";

    res.json({ ok: true, model: "claude", text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

app.post("/api/mistral", requireCodeword, async (req, res) => {
  try {
    const ingredientsString = toList(req.body);
    const response = await hf.chatCompletion({
      model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `I have ${ingredientsString}. Please give me a recipe you'd recommend I make!`,
        },
      ],
      max_tokens: 1024,
    });
    const text = response?.choices?.[0]?.message?.content ?? "";
    res.json({ ok: true, model: "mistral", text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () =>
  console.log(`API server listening on http://localhost:${PORT}`)
);
