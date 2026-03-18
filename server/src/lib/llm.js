import OpenAI from "openai";

function getProvider() {
  return (process.env.LLM_PROVIDER || "openai").toLowerCase();
}

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("replace_with_")) return null;
  return new OpenAI({ apiKey: key });
}

async function runOpenAI(system, user) {
  const openaiClient = getOpenAIClient();
  if (!openaiClient) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await openaiClient.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });
  return response.output_text?.trim() || null;
}

async function runGemini(system, user) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("replace_with_")) return null;

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: `SYSTEM:\n${system}\n\nUSER:\n${user}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function runOllama(system, user) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b";

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data?.message?.content?.trim() || null;
}

export async function runLLM({ system, user, fallback }) {
  try {
    let text = null;
    const provider = getProvider();

    if (provider === "gemini") {
      text = await runGemini(system, user);
    } else if (provider === "ollama") {
      text = await runOllama(system, user);
    } else {
      text = await runOpenAI(system, user);
    }

    return text || fallback;
  } catch {
    return fallback;
  }
}
